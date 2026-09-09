const MAX_BODY_BYTES = 32 * 1024;
const MAX_QUERY_LENGTH = 300;
const MAX_CURSOR_LENGTH = 500;
const MIN_CURATED_PRODUCTS = 20;
const MAX_CURATED_PRODUCTS = 50;
const MAX_SEARCH_RESULTS = 5;
const MAX_DETAIL_CONCURRENCY = 4;
const MAX_UPSTREAM_BYTES = 256 * 1024;
const MAX_MCP_REQUEST_BYTES = 32 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;

export const MANAGED_CATALOG_MODE = "managed_public_catalog";
export const MANAGED_CATALOG_CONTRACT = "reference-store-managed-public-catalog/v1";
export const MANAGED_MCP_PROTOCOL = "2025-06-18";
export const MANAGED_MCP_SERVER = Object.freeze({ name: "world-products", version: "1.0.0" });
export const MANAGED_CATALOG_READ_TOOLS = Object.freeze([
  "product_search", "search_catalog", "browse_catalog", "ask_catalog", "get_product",
]);
export const MANAGED_CATALOG_PATHS = Object.freeze(new Set([
  "/api/managed-catalog/curated",
  "/api/managed-catalog/search",
  "/api/managed-catalog/product",
]));

const SEARCH_STATUSES = new Set(["results", "needs_clarification", "no_match", "degraded"]);
const SCOPES = new Set(["curated", "broader_public_catalog"]);

export class ManagedCatalogPublicError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.name = "ManagedCatalogPublicError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, status) {
  throw new ManagedCatalogPublicError(code, status);
}

function exactFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => fields.has(key));
}

function explicitPort(value) {
  if (typeof value !== "string") return true;
  const authority = value.trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "").split(/[/?#]/u, 1)[0];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.startsWith("[") ? /\]:\d+$/u.test(host) : /:\d+$/u.test(host);
}

function publicHostname(value) {
  if (typeof value !== "string") return false;
  const hostname = value.trim().toLowerCase();
  if (!hostname || hostname.endsWith(".") || !hostname.includes(".")
    || /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname) || hostname.includes(":")) return false;
  const privateSuffix = [
    "localhost", "local", "internal", "corp", "lan", "localdomain", "home.arpa",
  ].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  return !privateSuffix && hostname.split(".").every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
  ));
}

function exactPublicOrigin(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || explicitPort(value)
      || url.pathname !== "/" || url.search || url.hash || !publicHostname(url.hostname)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function exactManagedEndpoint(value) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || explicitPort(value)
      || url.pathname !== "/mcp" || url.search || url.hash || !publicHostname(url.hostname)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function handleValue(value) {
  if (typeof value !== "string") return "";
  const handle = value.trim().toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/u.test(handle) ? handle : "";
}

export function canonicalManagedProductUrl(value, handle, storefront) {
  const productHandle = handleValue(handle);
  const origin = exactPublicOrigin(storefront);
  if (!productHandle || !origin || typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || explicitPort(value)
      || url.search || url.hash || !publicHostname(url.hostname) || url.origin !== origin
      || url.pathname !== `/products/${productHandle}`) return "";
    return `${origin}/products/${productHandle}`;
  } catch {
    return "";
  }
}

function isoTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : "";
}

function configuredImageOrigins(value, storefront) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    fail("managed_catalog_not_configured", 503);
  }
  const candidates = (value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (candidates.length > 8) fail("managed_catalog_not_configured", 503);
  const origins = candidates.map(exactPublicOrigin);
  if (origins.some((origin) => !origin)) fail("managed_catalog_not_configured", 503);
  return Object.freeze(new Set([storefront, ...origins]));
}

async function boundedJsonResponse(response) {
  if (!response || response.status !== 200 || response.redirected) {
    fail("managed_catalog_unavailable", 503);
  }
  const type = String(response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const declaredValue = String(response.headers.get("content-length") || "").trim();
  const declared = declaredValue ? Number(declaredValue) : 0;
  if (type !== "application/json") fail("invalid_upstream_content_type", 502);
  if (declaredValue && (!/^\d+$/u.test(declaredValue)
    || !Number.isSafeInteger(declared) || declared > MAX_UPSTREAM_BYTES)) {
    fail("upstream_response_too_large", 502);
  }
  if (!response.body) fail("invalid_upstream_contract", 502);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPSTREAM_BYTES) {
        await reader.cancel();
        fail("upstream_response_too_large", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let decoded;
  try { decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("invalid_upstream_contract", 502); }
  try { return JSON.parse(decoded); }
  catch { fail("invalid_upstream_contract", 502); }
}

export function createAnonymousManagedMcpAdapter(fetcher = globalThis.fetch) {
  if (typeof fetcher !== "function") fail("managed_catalog_not_configured", 503);
  let sessionId = "";
  let nextId = 1;
  async function send(endpoint, signal, method, params, notification = false) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      ...(!notification ? { id: `reference-store-${nextId++}` } : {}),
      method,
      ...(params === undefined ? {} : { params }),
    });
    if (new TextEncoder().encode(body).byteLength > MAX_MCP_REQUEST_BYTES) fail("request_too_large", 413);
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body,
      redirect: "error",
      signal,
    });
    if (notification) {
      if (![200, 202, 204].includes(response.status) || response.redirected) {
        fail("managed_catalog_unavailable", 503);
      }
      if (response.body) {
        await response.body.cancel();
        fail("invalid_upstream_contract", 502);
      }
      return null;
    }
    const payload = await boundedJsonResponse(response);
    const returnedSession = String(response.headers.get("mcp-session-id") || "").trim();
    if (returnedSession) {
      if (!/^[A-Za-z0-9._~+/=-]{1,256}$/u.test(returnedSession)
        || (sessionId && returnedSession !== sessionId)) fail("invalid_upstream_contract", 502);
      sessionId = returnedSession;
    }
    return payload;
  }
  return Object.freeze({
    async initialize({ endpoint, signal, protocolVersion, capabilities, clientInfo }) {
      const payload = await send(endpoint, signal, "initialize", {
        protocolVersion, capabilities, clientInfo,
      });
      rpcResult(payload);
      await send(endpoint, signal, "notifications/initialized", undefined, true);
      return payload;
    },
    async listTools({ endpoint, signal }) {
      return send(endpoint, signal, "tools/list", {});
    },
    async callTool({ endpoint, signal, name, arguments: argumentsValue }) {
      if (!MANAGED_CATALOG_READ_TOOLS.includes(name)) fail("invalid_request", 400);
      return send(endpoint, signal, "tools/call", { name, arguments: argumentsValue });
    },
  });
}

function safeImage(value, allowedOrigins) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    fail("invalid_upstream_contract", 502);
  }
  const candidate = (value || "").trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !explicitPort(candidate) && !url.search && !url.hash && publicHostname(url.hostname)
      && allowedOrigins.has(url.origin) ? url.href : "";
  } catch {
    return "";
  }
}

function configuredProfile(env) {
  if (typeof env?.BFF_RUNTIME_MODE !== "string" || env.BFF_RUNTIME_MODE.trim() !== MANAGED_CATALOG_MODE
    || typeof env?.MANAGED_CATALOG_ENABLED !== "string" || env.MANAGED_CATALOG_ENABLED.trim() !== "true") {
    fail("managed_catalog_not_configured", 503);
  }
  const endpoint = exactManagedEndpoint(env?.MANAGED_CATALOG_ENDPOINT);
  const allowedOrigin = exactPublicOrigin(env?.MANAGED_CATALOG_ALLOWED_ORIGIN);
  const storefront = exactPublicOrigin(env?.STOREFRONT_ORIGIN);
  if (!endpoint || !allowedOrigin || new URL(endpoint).origin !== allowedOrigin || !storefront) {
    fail("managed_catalog_not_configured", 503);
  }
  const boundFetch = typeof env?.MANAGED_CATALOG_FETCH?.fetch === "function"
    ? env.MANAGED_CATALOG_FETCH.fetch.bind(env.MANAGED_CATALOG_FETCH) : globalThis.fetch;
  const adapter = env?.MANAGED_CATALOG_ADAPTER || createAnonymousManagedMcpAdapter(boundFetch);
  if (!adapter || typeof adapter.initialize !== "function" || typeof adapter.listTools !== "function"
    || typeof adapter.callTool !== "function") {
    fail("managed_catalog_not_configured", 503);
  }
  const configuredTimeout = Number(env?.BFF_UPSTREAM_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(configuredTimeout) && configuredTimeout >= 100 && configuredTimeout <= 30_000
    ? configuredTimeout : DEFAULT_UPSTREAM_TIMEOUT_MS;
  const imageOrigins = configuredImageOrigins(env?.MANAGED_CATALOG_IMAGE_ORIGINS, storefront);
  return Object.freeze({ endpoint, storefront, imageOrigins, adapter, timeoutMs });
}

async function readJson(request, fields) {
  const type = String(request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  const declared = Number(request.headers.get("content-length") || 0);
  if (type !== "application/json" || (declared && (!Number.isSafeInteger(declared) || declared > MAX_BODY_BYTES))) {
    fail(declared > MAX_BODY_BYTES ? "request_too_large" : "invalid_request", declared > MAX_BODY_BYTES ? 413 : 400);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) fail("request_too_large", 413);
  let value;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { fail("invalid_request", 400); }
  if (!exactFields(value, fields)) fail("invalid_request", 400);
  return value;
}

function closedCohort(value) {
  const fields = new Set(["status", "reviewed_at", "expires_at", "handles"]);
  if (!exactFields(value, fields) || Object.keys(value).length !== fields.size || value.status !== "accepted"
    || !isoTimestamp(value.reviewed_at) || !isoTimestamp(value.expires_at)) return null;
  const reviewed = Date.parse(value.reviewed_at);
  const expires = Date.parse(value.expires_at);
  if (!(reviewed < expires && expires > Date.now())) return null;
  if (!Array.isArray(value.handles) || value.handles.length < MIN_CURATED_PRODUCTS
    || value.handles.length > MAX_CURATED_PRODUCTS) return null;
  const handles = value.handles.map(handleValue);
  if (handles.some((handle, index) => !handle || value.handles[index] !== handle)
    || new Set(handles).size !== handles.length) return null;
  return Object.freeze({ handles: Object.freeze(handles), reviewed_at: value.reviewed_at, expires_at: value.expires_at });
}

async function acceptedCohort(env) {
  const provider = env?.MANAGED_CATALOG_COHORT_PROVIDER;
  if (!provider || typeof provider.load !== "function") fail("curated_not_ready", 503);
  try {
    const cohort = closedCohort(await provider.load());
    if (!cohort) fail("curated_not_ready", 503);
    return cohort;
  } catch (error) {
    if (error instanceof ManagedCatalogPublicError) throw error;
    fail("curated_not_ready", 503);
  }
}

function catalogPrice(value) {
  if (Object.hasOwn(value, "currency") && value.currency !== null && value.currency !== undefined
    && typeof value.currency !== "string") fail("invalid_upstream_contract", 502);
  const candidates = ["price", "price_usd"]
    .filter((field) => Object.hasOwn(value, field) && value[field] !== null && value[field] !== undefined)
    .map((field) => value[field]);
  if (candidates.some((candidate) => typeof candidate !== "number"
    || !Number.isFinite(candidate) || candidate < 0)) fail("invalid_upstream_contract", 502);
  if (candidates.length > 1 && candidates.some((candidate) => candidate !== candidates[0])) {
    fail("invalid_upstream_contract", 502);
  }
  if (candidates.length === 0) return null;
  if (typeof value.currency !== "string") fail("invalid_upstream_contract", 502);
  const currency = value.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) fail("invalid_upstream_contract", 502);
  return Object.freeze({ amount: candidates[0], currency });
}

function publicProduct(value, profile, scope, cohort, expectedHandle = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_upstream_contract", 502);
  const handle = handleValue(value.handle);
  if (typeof value.title !== "string" || typeof value.purchase_status !== "string") {
    fail("invalid_upstream_contract", 502);
  }
  const title = value.title.trim();
  const price = catalogPrice(value);
  const catalogAvailable = typeof value.catalog_available === "boolean" ? value.catalog_available : null;
  const catalogPurchasable = typeof value.purchasable === "boolean" ? value.purchasable : null;
  const purchaseStatus = value.purchase_status.trim();
  const summaryValue = value.description ?? value.summary ?? "";
  if (typeof summaryValue !== "string") fail("invalid_upstream_contract", 502);
  if (Object.hasOwn(value, "cart_verification_required")
    && typeof value.cart_verification_required !== "boolean") fail("invalid_upstream_contract", 502);
  const productUrl = canonicalManagedProductUrl(
    `${profile.storefront}/products/${handle}`, handle, profile.storefront,
  );
  const image = safeImage(value.image ?? "", profile.imageOrigins);
  if (!handle || value.handle !== handle || (expectedHandle && handle !== expectedHandle)
    || !title || title.length > 200
    || catalogAvailable === null || catalogPurchasable === null
    || !purchaseStatus || purchaseStatus.length > 80 || !productUrl) {
    fail("invalid_upstream_contract", 502);
  }
  const curated = scope === "curated" && Boolean(cohort?.handles.includes(handle));
  return Object.freeze({
    handle,
    title,
    summary: summaryValue.slice(0, 1_000),
    image,
    catalog_price: price,
    catalog_available: catalogAvailable,
    catalog_purchasable: catalogPurchasable,
    purchase_status: purchaseStatus,
    cart_verification_required: typeof value.cart_verification_required === "boolean"
      ? value.cart_verification_required : true,
    commerce_verification_required: true,
    product_url: productUrl,
    catalog_scope: scope,
    curated,
    quality_label: curated ? "curated_cohort_member" : "broader_public_catalog_unreviewed",
    writes_disabled: true,
  });
}

async function callAdapter(operation, profile, input) {
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ManagedCatalogPublicError("upstream_timeout", 504));
      }, profile.timeoutMs);
    });
    const value = await Promise.race([
      profile.adapter[operation](Object.freeze({ endpoint: profile.endpoint, signal: controller.signal, ...input })),
      timeout,
    ]);
    let encoded;
    try { encoded = new TextEncoder().encode(JSON.stringify(value)); }
    catch { fail("invalid_upstream_contract", 502); }
    if (encoded.byteLength > MAX_UPSTREAM_BYTES) fail("upstream_response_too_large", 502);
    return value;
  } catch (error) {
    if (error instanceof ManagedCatalogPublicError) throw error;
    fail("managed_catalog_unavailable", 503);
  } finally {
    clearTimeout(timer);
  }
}

function rpcResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.jsonrpc !== "2.0"
    || !Object.hasOwn(value, "id") || !value.result || typeof value.result !== "object"
    || Array.isArray(value.result) || Object.hasOwn(value, "error")) fail("invalid_upstream_contract", 502);
  return value.result;
}

function stringEnum(schema, expected) {
  return schema?.type === "string" && Array.isArray(schema.enum)
    && expected.every((value) => schema.enum.includes(value));
}

export function validateManagedMcpDiscovery(initializeEnvelope, toolsEnvelope) {
  const initialized = rpcResult(initializeEnvelope);
  if (initialized.protocolVersion !== MANAGED_MCP_PROTOCOL
    || initialized.serverInfo?.name !== MANAGED_MCP_SERVER.name
    || initialized.serverInfo?.version !== MANAGED_MCP_SERVER.version) {
    fail("invalid_upstream_contract", 502);
  }
  const tools = rpcResult(toolsEnvelope).tools;
  if (!Array.isArray(tools)) fail("invalid_upstream_contract", 502);
  const byName = new Map();
  for (const tool of tools) {
    const name = typeof tool?.name === "string" ? tool.name : "";
    if (!name || byName.has(name)) fail("invalid_upstream_contract", 502);
    byName.set(name, tool);
  }
  if (MANAGED_CATALOG_READ_TOOLS.some((name) => !byName.has(name))) {
    fail("invalid_upstream_contract", 502);
  }
  const productSearch = byName.get("product_search")?.inputSchema;
  if (productSearch?.type !== "object"
    || !stringEnum(productSearch.properties?.mode, ["catalog", "recommendations"])
    || !stringEnum(productSearch.properties?.operation, ["search", "confirm_search", "more"])
    || productSearch.properties?.criteria?.type !== "object"
    || productSearch.properties?.criteria?.additionalProperties !== false) {
    fail("invalid_upstream_contract", 502);
  }
  for (const name of ["search_catalog", "ask_catalog"]) {
    const schema = byName.get(name)?.inputSchema;
    if (schema?.type !== "object" || !schema.properties?.query || !schema.required?.includes("query")) {
      fail("invalid_upstream_contract", 502);
    }
  }
  if (byName.get("browse_catalog")?.inputSchema?.type !== "object") {
    fail("invalid_upstream_contract", 502);
  }
  const detail = byName.get("get_product")?.inputSchema;
  if (detail?.type !== "object" || detail.properties?.handle?.type !== "string"
    || !detail.required?.includes("handle")) fail("invalid_upstream_contract", 502);
  return Object.freeze({
    protocol: MANAGED_MCP_PROTOCOL,
    server: MANAGED_MCP_SERVER,
    allowed_tools: MANAGED_CATALOG_READ_TOOLS,
  });
}

async function discoverManagedMcp(profile) {
  const initialized = await callAdapter("initialize", profile, {
    protocolVersion: MANAGED_MCP_PROTOCOL,
    capabilities: Object.freeze({}),
    clientInfo: Object.freeze({ name: "reference-store-bff", version: "1.0.0" }),
  });
  const tools = await callAdapter("listTools", profile, {});
  return validateManagedMcpDiscovery(initialized, tools);
}

async function callReadTool(profile, name, argumentsValue) {
  if (!MANAGED_CATALOG_READ_TOOLS.includes(name)) fail("invalid_request", 400);
  const result = rpcResult(await callAdapter("callTool", profile, {
    name,
    arguments: Object.freeze(argumentsValue),
  }));
  if (result.isError !== false || !result.structuredContent
    || typeof result.structuredContent !== "object" || Array.isArray(result.structuredContent)) {
    fail("invalid_upstream_contract", 502);
  }
  return result.structuredContent;
}

async function mapWithConcurrency(values, mapper) {
  const output = new Array(values.length);
  let next = 0;
  let failure;
  async function worker() {
    while (next < values.length && !failure) {
      const index = next;
      next += 1;
      try { output[index] = await mapper(values[index]); }
      catch (error) { failure = error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_DETAIL_CONCURRENCY, values.length) }, worker));
  if (failure) throw failure;
  return output;
}

function resultEnvelope(operation, status, products, extras = {}) {
  return Object.freeze({
    contract: MANAGED_CATALOG_CONTRACT,
    profile: MANAGED_CATALOG_MODE,
    operation,
    status,
    products: Object.freeze(products),
    writes_disabled: true,
    checkout_created: false,
    ...extras,
  });
}

async function curatedResponse(env, profile) {
  const cohort = await acceptedCohort(env);
  await discoverManagedMcp(profile);
  let products;
  try {
    products = await mapWithConcurrency(cohort.handles, async (handle) => {
      const value = await callReadTool(profile, "get_product", { handle });
      return publicProduct(value, profile, "curated", cohort, handle);
    });
  } catch {
    fail("curated_not_ready", 503);
  }
  if (products.length < MIN_CURATED_PRODUCTS || products.some((product) => !product.curated)
    || new Set(products.map((product) => product.handle)).size !== products.length) {
    fail("curated_not_ready", 503);
  }
  return resultEnvelope("curated", "ready", products, {
    reviewed_at: cohort.reviewed_at,
    expires_at: cohort.expires_at,
  });
}

function scopeInput(input) {
  const scope = typeof input.scope === "string" ? input.scope : "";
  if (!SCOPES.has(scope)) fail("invalid_request", 400);
  if (scope === "broader_public_catalog" && input.explicit_broader_search !== true) {
    fail("broader_search_opt_in_required", 400);
  }
  return scope;
}

async function searchResponse(request, env, profile) {
  const input = await readJson(request, new Set([
    "query", "scope", "explicit_broader_search", "operation", "limit", "cursor",
  ]));
  const scope = scopeInput(input);
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const limit = input.limit === undefined ? MAX_SEARCH_RESULTS : input.limit;
  const cursor = input.cursor === undefined || input.cursor === null ? null : input.cursor;
  if (cursor !== null && typeof cursor !== "string") fail("invalid_request", 400);
  if (!query || query.length > MAX_QUERY_LENGTH || typeof limit !== "number"
    || !Number.isInteger(limit) || limit < 1
    || limit > MAX_SEARCH_RESULTS || (cursor !== null && (!cursor || cursor.length > MAX_CURSOR_LENGTH))) {
    fail("invalid_request", 400);
  }
  const operation = input.operation === undefined ? (cursor ? "more" : "search") : input.operation;
  if (typeof operation !== "string") fail("invalid_request", 400);
  if (!["search", "confirm_search", "more"].includes(operation)
    || (operation === "more") !== Boolean(cursor)) fail("invalid_request", 400);
  const cohort = scope === "curated" ? await acceptedCohort(env) : null;
  await discoverManagedMcp(profile);
  const value = await callReadTool(profile, "product_search", {
    query, mode: "catalog", operation, limit, ...(cursor ? { cursor } : {}),
  });
  if (!value || typeof value !== "object" || !SEARCH_STATUSES.has(value.status)
    || value.mode !== "catalog" || typeof value.degraded !== "boolean"
    || !Array.isArray(value.results) || value.results.length > limit) fail("invalid_upstream_contract", 502);
  if (value.next_cursor !== null && value.next_cursor !== undefined
    && typeof value.next_cursor !== "string") fail("invalid_upstream_contract", 502);
  const nextCursorValue = value.next_cursor || "";
  const nextCursor = nextCursorValue || null;
  if (nextCursor !== null && nextCursor.length > MAX_CURSOR_LENGTH) fail("invalid_upstream_contract", 502);
  const nestedScope = value.search_scope;
  if (nestedScope !== undefined && (!nestedScope || typeof nestedScope !== "object" || Array.isArray(nestedScope))) {
    fail("invalid_upstream_contract", 502);
  }
  const scanCapped = value.scan_limit_reached === true || nestedScope?.scan_limit_reached === true;
  const incomplete = value.retrieval_incomplete === true || scanCapped;
  const degraded = value.degraded === true || nestedScope?.degraded === true;
  if ((value.status === "degraded") !== degraded || (value.status !== "degraded" && incomplete)) {
    fail("invalid_upstream_contract", 502);
  }
  for (const [top, nested] of [
    [value.bounded_plan_complete, nestedScope?.plan_complete],
    [value.search_scope_exhausted, nestedScope?.scope_exhausted],
    [value.scan_limit_reached, nestedScope?.scan_limit_reached],
    [value.degraded, nestedScope?.degraded],
  ]) {
    if (typeof top === "boolean" && typeof nested === "boolean" && top !== nested) {
      fail("invalid_upstream_contract", 502);
    }
  }
  if (value.status === "results" && value.results.length === 0) fail("invalid_upstream_contract", 502);
  if (value.status === "no_match" && (value.results.length !== 0 || nextCursor !== null
    || value.has_more === true || value.degraded || value.retrieval_incomplete
    || value.bounded_plan_complete !== true || value.search_scope_exhausted !== true || scanCapped)) {
    fail("invalid_upstream_contract", 502);
  }
  const candidateResults = scope === "curated"
    ? value.results.filter((product) => cohort.handles.includes(handleValue(product?.handle)))
    : value.results;
  const visible = candidateResults.filter((product, index) => (
    candidateResults.findIndex((candidate) => handleValue(candidate?.handle) === handleValue(product?.handle)) === index
  ));
  if (scope === "curated" && value.status === "results" && visible.length === 0
    && (nextCursor !== null || value.has_more === true)) {
    fail("invalid_upstream_contract", 502);
  }
  const products = visible.map((product) => publicProduct(product, profile, scope, cohort));
  const status = value.status;
  return resultEnvelope("search", status, products, {
    scope,
    search_operation: operation,
    upstream_status: value.status,
    upstream_degraded: value.degraded,
    broader_catalog_quality_verified: false,
    next_cursor: nextCursor,
  });
}

async function productResponse(request, env, profile) {
  const input = await readJson(request, new Set(["handle", "scope", "explicit_broader_search"]));
  const scope = scopeInput(input);
  const handle = handleValue(input.handle);
  if (!handle) fail("invalid_request", 400);
  const cohort = scope === "curated" ? await acceptedCohort(env) : null;
  if (cohort && !cohort.handles.includes(handle)) fail("product_not_curated", 404);
  await discoverManagedMcp(profile);
  const value = await callReadTool(profile, "get_product", { handle });
  const product = publicProduct(value, profile, scope, cohort, handle);
  return resultEnvelope("product", "results", [product], { scope });
}

export function isManagedCatalogPath(pathname) {
  return MANAGED_CATALOG_PATHS.has(pathname);
}

export async function handleManagedCatalogRequest(request, env, pathname) {
  const profile = configuredProfile(env);
  if (request.method === "GET" && pathname === "/api/managed-catalog/curated") {
    return curatedResponse(env, profile);
  }
  if (request.method === "POST" && pathname === "/api/managed-catalog/search") {
    return searchResponse(request, env, profile);
  }
  if (request.method === "POST" && pathname === "/api/managed-catalog/product") {
    return productResponse(request, env, profile);
  }
  fail("not_found", 404);
}
