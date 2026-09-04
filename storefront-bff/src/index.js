const MAX_BODY_BYTES = 32 * 1024;
const MAX_PROXY_QUERY_BYTES = 8 * 1024;
const MAX_PROXY_QUERY_PARAMETERS = 32;
const MAX_PROXY_PARAMETER_BYTES = 2 * 1024;
const MAX_MESSAGES = 12;
const MAX_RESULTS = 50;
const MAX_UPSTREAM_BYTES = 256 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;
const RUNTIME_STATUS_CONTRACT = "reference-store-runtime-status/v1";
const RUNTIME_RUN_CONTRACT = "reference-store-read-run/v1";
const RUNTIME_DOCTOR_CONTRACT = "reference-store-runtime-doctor/v1";
export const RUNTIME_PUBLIC_ERRORS = Object.freeze([
  "app_proxy_authentication_failed", "app_proxy_timestamp_expired", "authentication_failed",
  "credential_missing", "deployment_not_configured", "invalid_request",
  "invalid_shopify_product_url", "invalid_upstream_content_type", "invalid_upstream_contract",
  "local_binding_required", "not_found", "origin_not_allowed", "permission_required", "quota_exceeded",
  "request_too_large", "runtime_mode_mismatch", "runtime_not_configured", "service_unavailable",
  "upstream_contract_unavailable", "upstream_redirect_rejected", "upstream_response_too_large",
  "upstream_timeout",
]);
const RUNTIME_PUBLIC_ERROR_SET = new Set(RUNTIME_PUBLIC_ERRORS);
const SANDBOX_STATUS_CONTRACT = "shopify-live-sandbox-status/v1";
const SHOPIFY_SANDBOX_API_VERSION = "2026-07";
const RUNTIME_MODES = new Set(["synthetic_local_sandbox", "shopify_read_only"]);
const CREDENTIAL_STATES = new Set([
  "mock_ready", "credential_missing", "authentication_failed", "permission_required",
  "quota_exceeded", "service_unavailable", "succeeded",
]);
const STATUS_ERROR_CODES = new Set([
  "CREDENTIAL_MISSING", "AUTHENTICATION_FAILED", "PERMISSION_REQUIRED",
  "QUOTA_EXCEEDED", "SERVICE_UNAVAILABLE",
]);
const STATUS_ERROR_BY_STATE = Object.freeze({
  credential_missing: "CREDENTIAL_MISSING",
  authentication_failed: "AUTHENTICATION_FAILED",
  permission_required: "PERMISSION_REQUIRED",
  quota_exceeded: "QUOTA_EXCEEDED",
  service_unavailable: "SERVICE_UNAVAILABLE",
});
const STATUS_FIELDS = new Set([
  "contract", "mode", "verified", "credential_state", "data_source", "api_version",
  "quota", "writes", "non_transactional", "capabilities", "checked_at", "error_code",
  "purchasable", "shipping_rates", "commerce_writes", "credential_exposed",
]);
const STATUS_QUOTA_FIELDS = new Set([
  "limit", "remaining", "window_seconds", "concurrency_limit", "reset_at",
]);
const STATUS_CAPABILITY_FIELDS = new Set([
  "doctor", "catalog_search", "search_contract_v2", "product_detail", "storefront_health",
  "cart", "checkout", "order", "payment", "inventory", "publication", "product_mutation",
]);
const RUNTIME_CAPABILITY_FIELDS = Object.freeze([
  "doctor", "catalog_search", "search_contract_v2", "product_detail", "storefront_health",
]);
const RUNTIME_SEARCH_FIELDS = new Set([
  "contract_version", "trace_id", "status", "normalized_intent", "relaxations",
  "missing_criteria", "results", "pagination", "search_scope", "mode", "data_source",
  "illustrative_only", "purchasable", "available", "writes", "non_transactional",
  "transaction_boundary", "shopify_verified_at", "compatibility",
]);
const RUNTIME_SEARCH_REQUIRED_FIELDS = [
  "contract_version", "trace_id", "status", "normalized_intent", "relaxations",
  "missing_criteria", "results", "pagination", "search_scope", "mode", "data_source",
  "illustrative_only", "purchasable", "available", "writes", "non_transactional",
  "transaction_boundary", "shopify_verified_at",
];
const RUNTIME_PRODUCT_FIELDS = new Set([
  "public_id", "slug", "title", "description", "category", "tags", "images", "attributes",
  "price", "availability_band", "lead_time_days", "as_of", "purchasable", "handle",
  "availableForSale", "shopify_verified_at", "non_transactional", "transaction_boundary",
  "writes", "mode", "data_source", "illustrative_only", "available", "product_url",
  "add_to_cart_url",
]);
const PUBLIC_PRODUCT_ATTRIBUTE_FIELDS = new Set([
  "age_range", "battery_mah", "battery_wh", "brand", "capacity_l", "capacity_ml",
  "certification", "certifications", "color", "colors", "colour", "compartment_count",
  "compatibility", "compatible_models", "depth_cm", "depth_in", "depth_mm", "diameter_cm",
  "diameter_in", "diameter_mm", "dimensions", "feature", "features", "finish", "gender",
  "height_cm", "height_in", "height_mm", "length_cm", "length_in", "length_mm", "material",
  "materials", "model", "pack_size", "pattern", "piece_count", "pieces", "pocket_count",
  "pockets", "power", "shape", "size", "sizes", "style", "styles", "thickness_cm",
  "thickness_in", "thickness_mm", "use_case", "voltage", "volume_l", "volume_ml", "weight",
  "weight_g", "weight_kg", "weight_lb", "weight_oz", "width_cm", "width_in", "width_mm",
]);
// Worker runtimes may provide a fresh `env` wrapper for every invocation, so
// object identity cannot be the quota boundary.  Key the isolate-local bucket
// only by operator-controlled runtime configuration instead.
const runtimeQuotaStates = new Map();
const SEARCH_CONTRACT_VERSION = "2.0";
const SEARCH_STATUSES = new Set(["results", "needs_clarification", "no_match", "degraded"]);
const CONDITION_SOURCES = new Set(["explicit", "inferred", "default"]);
const CONDITION_SCOPES = new Set(["product", "session", "transaction"]);
const CONDITION_HARDNESS = new Set(["hard", "soft", "informational"]);
const SEARCH_V2_REQUEST_FIELDS = new Set([
  "contract_version", "product_identity", "hard_constraints", "soft_context",
  "transaction_context", "limit", "cursor",
]);
const SEARCH_V2_REQUIRED_FIELDS = [
  "contract_version", "product_identity", "hard_constraints", "soft_context",
  "transaction_context", "limit",
];
const SEARCH_V2_CONDITION_FIELDS = new Set(["name", "value", "source", "scope", "hardness"]);
const SEARCH_V2_PRICE_CONSTRAINTS = new Set(["price_min", "price_max"]);
const SEARCH_V2_TEXT_CONSTRAINTS = new Set(["material", "color", "must_have", "exclude"]);
const SEARCH_V2_HARD_CONSTRAINTS = new Set([
  ...SEARCH_V2_PRICE_CONSTRAINTS, ...SEARCH_V2_TEXT_CONSTRAINTS,
]);
const SEARCH_V2_TRANSACTION_CONDITIONS = new Set(["ship_to", "quantity", "delivery_days_max"]);

function upstreamPageSize(requested, env) {
  const configured = Number(env.AGENT_CORE_PAGE_SIZE || 20);
  const ceiling = Number.isInteger(configured) && configured >= 1 && configured <= MAX_RESULTS ? configured : 20;
  return Math.min(Math.max(Number(requested) || ceiling, 1), ceiling);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

function normalizedBase(value) {
  try {
    const url = new URL(String(value || "").trim());
    const local = url.hostname === "localhost"
      || url.hostname === "[::1]"
      || url.hostname === ["127", "0", "0", "1"].join(".");
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return "";
    if (url.username || url.password || url.search || url.hash) return "";
    return url.href.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function storefrontOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    if (url.pathname !== "/") return "";
    return url.origin;
  } catch {
    return "";
  }
}

function allowedOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return !origin || allowed.includes(origin) ? origin : null;
}

function cors(origin) {
  return origin
    ? { "access-control-allow-origin": origin, vary: "Origin" }
    : {};
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function exactObjectFields(value, fields) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.size
    && Object.keys(value).every((key) => fields.has(key));
}

function exactCanonicalValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => exactCanonicalValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key)
      && exactCanonicalValue(left[key], right[key]));
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function privateOrIpHostname(value) {
  const hostname = String(value || "").toLowerCase().replace(/^\[|\]$/gu, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname.endsWith(".local") || hostname.endsWith(".internal")
    || hostname.endsWith(".corp") || hostname.endsWith(".lan")
    || hostname.endsWith(".localdomain") || hostname.endsWith(".home.arpa")) return true;
  // URL canonicalization turns legacy decimal/octal/hex IPv4 spellings into a
  // dotted address. Reject every IP literal, not just RFC1918 ranges.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname) || hostname.includes(":")) return true;
  return false;
}

function publicDnsHostname(value) {
  const hostname = String(value || "").toLowerCase();
  if (privateOrIpHostname(hostname) || hostname.endsWith(".") || hostname.length > 253
    || !hostname.includes(".")) return false;
  return hostname.split(".").every((label) => (
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
  ));
}

function explicitUrlPort(value) {
  const text = String(value || "").trim();
  const authority = text.replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "").split(/[/?#]/u, 1)[0];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.startsWith("[") ? /\]:\d+$/u.test(host) : /:\d+$/u.test(host);
}

function publicStorefrontOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || explicitUrlPort(value)
      || url.pathname !== "/" || url.search || url.hash || !publicDnsHostname(url.hostname)) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function verifiedShopifyProductUrl(value, handle, configuredOrigin) {
  if (!configuredOrigin || typeof value !== "string" || !/^[a-z0-9-]{1,100}$/u.test(handle)) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || explicitUrlPort(value)
      || url.search || url.hash
      || !publicDnsHostname(url.hostname) || url.origin !== configuredOrigin
      || url.pathname !== `/products/${handle}`) return "";
    return `${configuredOrigin}/products/${handle}`;
  } catch {
    return "";
  }
}

export class RuntimePublicError extends Error {
  constructor(code, status, runtime = null, retryAfter = "") {
    super(code);
    this.name = "RuntimePublicError";
    this.code = code;
    this.status = status;
    this.runtime = runtime;
    this.retryAfter = retryAfter;
  }
}

function safeRetryAfter(value) {
  const candidate = String(value || "").trim();
  if (!/^\d{1,6}$/u.test(candidate)) return "";
  const seconds = Number(candidate);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 86_400
    ? String(seconds) : "";
}

function runtimeFailure(code, status, runtime = null, retryAfter = "") {
  const publicCode = RUNTIME_PUBLIC_ERROR_SET.has(code) ? code : "service_unavailable";
  throw new RuntimePublicError(publicCode, status, runtime, safeRetryAfter(retryAfter));
}

function expectedRuntimeMode(env) {
  const mode = String(env?.BFF_RUNTIME_MODE || "").trim();
  if (!RUNTIME_MODES.has(mode)) runtimeFailure("runtime_not_configured", 503);
  return mode;
}

function validStatusQuota(value) {
  return exactObjectFields(value, STATUS_QUOTA_FIELDS)
    && ["limit", "remaining", "window_seconds", "concurrency_limit"]
      .every((field) => Number.isInteger(value[field]) && value[field] >= 0)
    && value.remaining <= value.limit
    && (value.reset_at === null || exactIsoTimestamp(value.reset_at));
}

function validStatusCapabilities(value) {
  return exactObjectFields(value, STATUS_CAPABILITY_FIELDS)
    && [...STATUS_CAPABILITY_FIELDS].every((field) => typeof value[field] === "boolean")
    && value.doctor === true
    && ["cart", "checkout", "order", "payment", "inventory", "publication", "product_mutation"]
      .every((field) => value[field] === false);
}

export function validateSandboxStatus(value) {
  if (!exactObjectFields(value, STATUS_FIELDS)
    || value.contract !== SANDBOX_STATUS_CONTRACT
    || !RUNTIME_MODES.has(value.mode)
    || typeof value.verified !== "boolean"
    || !CREDENTIAL_STATES.has(value.credential_state)
    || !["synthetic_fixture", "shopify_storefront_graphql"].includes(value.data_source)
    || !(value.api_version === null || value.api_version === SHOPIFY_SANDBOX_API_VERSION)
    || !validStatusQuota(value.quota)
    || value.writes !== false
    || value.non_transactional !== true
    || !validStatusCapabilities(value.capabilities)
    || !exactIsoTimestamp(value.checked_at)
    || !(value.error_code === null || STATUS_ERROR_CODES.has(value.error_code))
    || value.purchasable !== false
    || value.shipping_rates !== false
    || value.commerce_writes !== false
    || value.credential_exposed !== false) return false;

  const readCapabilities = [
    "catalog_search", "search_contract_v2", "product_detail", "storefront_health",
  ];
  if (value.mode === "synthetic_local_sandbox") {
    return value.verified === true
      && value.credential_state === "mock_ready"
      && value.data_source === "synthetic_fixture"
      && value.api_version === null
      && value.error_code === null
      && value.capabilities.catalog_search === true
      && value.capabilities.search_contract_v2 === true
      && value.capabilities.product_detail === true
      && value.capabilities.storefront_health === false;
  }
  if (value.data_source !== "shopify_storefront_graphql"
    || value.api_version !== SHOPIFY_SANDBOX_API_VERSION) return false;
  if (value.verified) {
    return value.credential_state === "succeeded"
      && value.error_code === null
      && readCapabilities.every((field) => value.capabilities[field] === true);
  }
  return value.credential_state !== "mock_ready"
    && value.credential_state !== "succeeded"
    && value.error_code === STATUS_ERROR_BY_STATE[value.credential_state]
    && readCapabilities.every((field) => value.capabilities[field] === false);
}

export function projectRuntimeStatus(value, expectedMode) {
  if (!validateSandboxStatus(value)) runtimeFailure("invalid_upstream_contract", 502);
  if (!RUNTIME_MODES.has(expectedMode) || value.mode !== expectedMode) {
    runtimeFailure("runtime_mode_mismatch", 502);
  }
  const capabilities = {};
  for (const field of RUNTIME_CAPABILITY_FIELDS) capabilities[field] = value.capabilities[field];
  return Object.freeze({
    contract: RUNTIME_STATUS_CONTRACT,
    source_contract: value.contract,
    mode: value.mode,
    connected: value.verified,
    credential_state: value.credential_state,
    data_source: value.data_source,
    api_version: value.api_version,
    quota: Object.freeze({
      limit: value.quota.limit,
      remaining: value.quota.remaining,
      window_seconds: value.quota.window_seconds,
      concurrency_limit: value.quota.concurrency_limit,
      reset_at: value.quota.reset_at,
    }),
    writes_disabled: true,
    capabilities: Object.freeze(capabilities),
    checked_at: value.checked_at,
    error_code: value.error_code,
    boundaries: Object.freeze({
      non_transactional: true,
      purchasable: false,
      shipping_rates: false,
      commerce_writes: false,
      credential_exposed: false,
    }),
  });
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function acquireRuntimeQuota(env) {
  const limit = boundedInteger(env?.BFF_QUOTA_LIMIT, 120, 1, 10_000);
  const windowSeconds = boundedInteger(env?.BFF_QUOTA_WINDOW_SECONDS, 60, 1, 3_600);
  const concurrencyLimit = boundedInteger(env?.BFF_CONCURRENCY_LIMIT, 8, 1, 100);
  const quotaKey = JSON.stringify([
    String(env?.BFF_DEPLOYMENT_MODE || "local"),
    String(env?.BFF_RUNTIME_MODE || ""),
    String(env?.AGENT_CORE_SANDBOX_URL || ""),
    String(env?.SHOPIFY_APP_PROXY_SHOP || ""),
    limit,
    windowSeconds,
    concurrencyLimit,
  ]);
  const now = Date.now();
  let state = runtimeQuotaStates.get(quotaKey);
  if (!state || now >= state.windowStartedAt + (windowSeconds * 1_000)) {
    state = { windowStartedAt: now, used: 0, inFlight: 0 };
    runtimeQuotaStates.set(quotaKey, state);
    // Configuration is operator-controlled and normally produces one bucket,
    // but keep hot-reload/test churn bounded for long-lived isolates.
    if (runtimeQuotaStates.size > 64) {
      const oldest = runtimeQuotaStates.keys().next().value;
      if (oldest !== quotaKey) runtimeQuotaStates.delete(oldest);
    }
  }
  const resetSeconds = Math.max(1, Math.ceil(
    ((state.windowStartedAt + (windowSeconds * 1_000)) - now) / 1_000,
  ));
  if (state.used >= limit || state.inFlight >= concurrencyLimit) {
    runtimeFailure("quota_exceeded", 429, null, String(resetSeconds));
  }
  state.used += 1;
  state.inFlight += 1;
  let released = false;
  return () => {
    if (!released) state.inFlight = Math.max(0, state.inFlight - 1);
    released = true;
  };
}

function sandboxBase(value) {
  try {
    const url = new URL(String(value || "").trim());
    const local = url.hostname === "127.0.0.1";
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || (!local && !publicDnsHostname(url.hostname))) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function sandboxCredential(value) {
  const credential = String(value || "").trim();
  if (credential && /[\u0000-\u001f\u007f]/u.test(credential)) {
    runtimeFailure("runtime_not_configured", 503);
  }
  return credential;
}

function sandboxAuthHeaders(base, env) {
  const token = sandboxCredential(env?.AGENT_CORE_SANDBOX_TOKEN);
  const invite = sandboxCredential(env?.AGENT_CORE_SANDBOX_INVITE);
  if (token && invite) runtimeFailure("runtime_not_configured", 503);
  const local = new URL(base).hostname === "127.0.0.1";
  if (local) {
    if (invite) runtimeFailure("runtime_not_configured", 503);
    return token ? { authorization: `Bearer ${token}` } : {};
  }
  if (token) runtimeFailure("runtime_not_configured", 503);
  return invite ? { "x-sandbox-invite": invite } : {};
}

function runtimeTimeout(env) {
  return boundedInteger(env?.BFF_UPSTREAM_TIMEOUT_MS, DEFAULT_UPSTREAM_TIMEOUT_MS, 100, 30_000);
}

function upstreamFailureForStatus(status, retryAfter = "") {
  if (status === 401) runtimeFailure("authentication_failed", 502);
  if (status === 403) runtimeFailure("permission_required", 502);
  if (status === 429) runtimeFailure("quota_exceeded", 429, null, retryAfter);
  if (status === 408 || status === 504) runtimeFailure("upstream_timeout", 504);
  if (status === 400 || status === 404 || status === 405) runtimeFailure("upstream_contract_unavailable", 502);
  runtimeFailure("service_unavailable", 503);
}

async function readBoundedJson(response) {
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!/^application\/json(?:\s*;|$)/u.test(type)) {
    await response.body?.cancel("invalid_upstream_content_type").catch(() => {});
    runtimeFailure("invalid_upstream_content_type", 502);
  }
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) {
    await response.body?.cancel("upstream_response_too_large").catch(() => {});
    runtimeFailure("upstream_response_too_large", 502);
  }
  const reader = response.body?.getReader();
  if (!reader) runtimeFailure("invalid_upstream_contract", 502);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_UPSTREAM_BYTES) {
      await reader.cancel();
      runtimeFailure("upstream_response_too_large", 502);
    }
    try {
      text += decoder.decode(chunk.value, { stream: true });
    } catch {
      await reader.cancel("invalid_upstream_contract").catch(() => {});
      runtimeFailure("invalid_upstream_contract", 502);
    }
  }
  try {
    text += decoder.decode();
  } catch {
    runtimeFailure("invalid_upstream_contract", 502);
  }
  try {
    return JSON.parse(text);
  } catch {
    runtimeFailure("invalid_upstream_contract", 502);
  }
}

async function sandboxUpstream(path, init, env) {
  const base = sandboxBase(env?.AGENT_CORE_SANDBOX_URL);
  if (!base) runtimeFailure("runtime_not_configured", 503);
  const authHeaders = sandboxAuthHeaders(base, env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtimeTimeout(env));
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json; charset=utf-8" } : {}),
        ...authHeaders,
      },
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel("upstream_redirect_rejected").catch(() => {});
      runtimeFailure("upstream_redirect_rejected", 502);
    }
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after") || "";
      await response.body?.cancel("upstream_error").catch(() => {});
      upstreamFailureForStatus(response.status, retryAfter);
    }
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof RuntimePublicError) throw error;
    if (controller.signal.aborted || error?.name === "AbortError") runtimeFailure("upstream_timeout", 504);
    runtimeFailure("service_unavailable", 503);
  } finally {
    clearTimeout(timer);
  }
}

function configuredProxyShop(value) {
  const shop = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u.test(shop) ? shop : "";
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function equalText(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function proxyMessage(searchParams) {
  const grouped = new Map();
  for (const [key, value] of searchParams) {
    if (key === "signature") continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  return [...grouped].map(([key, values]) => `${key}=${values.join(",")}`).sort().join("");
}

async function verifyAppProxy(request, env) {
  const url = new URL(request.url);
  const encoder = new TextEncoder();
  if (encoder.encode(url.search).byteLength > MAX_PROXY_QUERY_BYTES) {
    runtimeFailure("request_too_large", 413);
  }
  let parameterCount = 0;
  for (const [key, value] of url.searchParams) {
    parameterCount += 1;
    if (parameterCount > MAX_PROXY_QUERY_PARAMETERS
      || encoder.encode(key).byteLength > MAX_PROXY_PARAMETER_BYTES
      || encoder.encode(value).byteLength > MAX_PROXY_PARAMETER_BYTES) {
      runtimeFailure("request_too_large", 413);
    }
  }
  const signatures = url.searchParams.getAll("signature");
  const timestamps = url.searchParams.getAll("timestamp");
  const shops = url.searchParams.getAll("shop");
  const configuredShop = configuredProxyShop(env?.SHOPIFY_APP_PROXY_SHOP);
  const secret = String(env?.SHOPIFY_APP_PROXY_SECRET || "");
  if (!configuredShop || secret.length < 16) runtimeFailure("deployment_not_configured", 503);
  if (signatures.length !== 1 || !/^[a-f0-9]{64}$/u.test(signatures[0])
    || timestamps.length !== 1 || !/^\d{10}$/u.test(timestamps[0])
    || shops.length !== 1 || shops[0].toLowerCase() !== configuredShop) {
    runtimeFailure("app_proxy_authentication_failed", 401);
  }
  const timestamp = Number(timestamps[0]);
  const windowSeconds = boundedInteger(env?.SHOPIFY_APP_PROXY_TIMESTAMP_WINDOW_SECONDS, 300, 30, 900);
  if (!Number.isSafeInteger(timestamp)
    || Math.abs(Math.floor(Date.now() / 1_000) - timestamp) > windowSeconds) {
    runtimeFailure("app_proxy_timestamp_expired", 401);
  }
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(proxyMessage(url.searchParams))));
  if (!equalText(digest, signatures[0])) runtimeFailure("app_proxy_authentication_failed", 401);
}

async function authorizeRuntimeRequest(request, env) {
  const deployment = String(env?.BFF_DEPLOYMENT_MODE || "").trim();
  const url = new URL(request.url);
  if (deployment === "local") {
    if (url.hostname !== "127.0.0.1") runtimeFailure("local_binding_required", 403);
    if (url.search) runtimeFailure("invalid_request", 400);
    return;
  }
  if (deployment === "shopify_app_proxy") {
    await verifyAppProxy(request, env);
    return;
  }
  runtimeFailure("deployment_not_configured", 503);
}

function contractCondition(value) {
  if (!exactObjectFields(value, SEARCH_V2_CONDITION_FIELDS)) return null;
  if (typeof value.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value.name)) return null;
  const name = value.name;
  const source = value.source;
  const scope = value.scope;
  const hardness = value.hardness;
  if (!CONDITION_SOURCES.has(source)
    || !CONDITION_SCOPES.has(scope)
    || !CONDITION_HARDNESS.has(hardness)) return null;
  const values = Array.isArray(value.value) ? value.value : [value.value];
  if (!values.length || values.length > 50
    || values.some((item) => (
      (typeof item === "string" && (!item.trim() || item.length > 300))
      || (typeof item === "number" && !Number.isFinite(item))
      || !["string", "number", "boolean"].includes(typeof item)
    ))) return null;
  return {
    name,
    value: Array.isArray(value.value) ? [...value.value] : value.value,
    source,
    scope,
    hardness,
  };
}

function publicConditions(value) {
  return (Array.isArray(value) ? value : []).slice(0, 50).map(contractCondition).filter(Boolean);
}

function isProductIdentityCondition(condition) {
  return Boolean(condition
    && condition.name === "product_identity"
    && typeof condition.value === "string"
    && condition.scope === "product"
    && condition.hardness === "hard");
}

function isHardConstraint(condition) {
  return Boolean(condition
    && condition.source === "explicit"
    && condition.scope === "product"
    && condition.hardness === "hard"
    && SEARCH_V2_HARD_CONSTRAINTS.has(condition.name)
    && (SEARCH_V2_PRICE_CONSTRAINTS.has(condition.name)
      ? typeof condition.value === "number" && Number.isFinite(condition.value) && condition.value >= 0
      : isSearchV2TextCriterion(condition.value)));
}

function isSearchV2TextCriterion(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.length >= 1 && values.length <= 20
    && values.every((item) => typeof item === "string" && item.trim() && item.length <= 80);
}

function isSoftContext(condition) {
  return Boolean(condition
    && (condition.scope === "product" || condition.scope === "session")
    && (condition.hardness === "soft" || condition.hardness === "informational"));
}

function isTransactionContext(condition) {
  return Boolean(condition
    && condition.scope === "transaction"
    && (condition.hardness === "hard" || condition.hardness === "informational")
    && (condition.hardness !== "hard" || condition.source === "explicit")
    && SEARCH_V2_TRANSACTION_CONDITIONS.has(condition.name)
    && (condition.name === "ship_to"
      ? typeof condition.value === "string" && condition.value.trim()
        && condition.value.length <= 100
      : Number.isInteger(condition.value) && condition.value >= 1));
}

function publicRelaxations(value) {
  return (Array.isArray(value) ? value : []).slice(0, 100).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const condition = String(item.condition || "").trim().toLowerCase();
    const reason = String(item.reason || "").trim().slice(0, 300);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(condition) || !reason) return [];
    const output = { condition, reason };
    if (["string", "number", "boolean"].includes(typeof item.from)) output.from = item.from;
    if (["string", "number", "boolean"].includes(typeof item.to)) output.to = item.to;
    return [output];
  });
}

function sameOriginUrl(value, origin) {
  const candidate = safeUrl(value);
  if (!candidate || !origin) return "";
  try {
    return new URL(candidate).origin === new URL(origin).origin ? candidate : "";
  } catch {
    return "";
  }
}

function productImage(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  for (const image of images) {
    const candidate = safeUrl(typeof image === "string" ? image : image?.url);
    if (candidate) return candidate;
  }
  return "";
}

function storefrontProduct(product, env) {
  const slug = String(product?.slug || product?.handle || "").trim();
  const store = storefrontOrigin(env.STOREFRONT_ORIGIN);
  const price = product?.price && typeof product.price === "object"
    ? product.price
    : { amount: product?.price, currency: product?.currency };
  const amount = Number(price?.amount);
  const availability = String(product?.availability_band || product?.availability || "").toLowerCase();
  // A deterministic slug URL is useful for browsing, but it does not prove
  // that a Shopify product/variant exists or is purchasable. Only an explicit
  // customer-facing URL on this configured storefront is purchase evidence.
  const verifiedProductUrl = sameOriginUrl(product?.product_url || product?.url, store);
  const browseUrl = verifiedProductUrl
    || (store && slug ? `${store}/products/${encodeURIComponent(slug)}` : "");
  const verifiedAddToCartUrl = sameOriginUrl(product?.add_to_cart_url, store);
  const available = product?.purchasable === true
    && availability !== "out_of_stock"
    && Boolean(verifiedProductUrl);
  return {
    public_id: String(product?.public_id || ""),
    handle: slug,
    title: String(product?.title || "Product").slice(0, 240),
    type: String(product?.category || product?.type || "").slice(0, 100),
    summary: String(product?.description || product?.summary || "").slice(0, 500),
    image: productImage(product) || safeUrl(product?.image),
    url: browseUrl,
    browse_url: browseUrl,
    product_url: verifiedProductUrl,
    add_to_cart_url: available ? verifiedAddToCartUrl : "",
    price: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: /^[A-Z]{3}$/.test(String(price?.currency || "").toUpperCase())
      ? String(price.currency).toUpperCase()
      : null,
    available,
    purchase_handoff: available ? "merchant_product" : null,
  };
}

function nextActions(actions) {
  return (Array.isArray(actions) ? actions : []).slice(0, 3).map((action) => {
    if (typeof action === "string") return { label: action, message: action, operation: "chat" };
    return {
      label: String(action?.label || action?.message || "Continue").slice(0, 120),
      message: String(action?.message || action?.label || "Continue").slice(0, 500),
      operation: String(action?.operation || "chat").slice(0, 40),
    };
  });
}

function sessionId(value) {
  const candidate = String(value || "");
  if (/^[a-zA-Z0-9_-]{8,120}$/.test(candidate)) return candidate;
  return `chat_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function requestJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new Response(null, { status: 413 });
  const reader = request.body?.getReader();
  const chunks = [];
  let received = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel("request_too_large").catch(() => {});
        throw new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Response(null, { status: 400 });
  }
}

function chatBody(input) {
  const messages = (Array.isArray(input?.messages) ? input.messages : [])
    .slice(-MAX_MESSAGES)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      // Agent Core V1 accepts a maximum 300-character query. Bound every
      // forwarded turn so the final user message cannot be rejected upstream.
      content: String(message?.content || "").trim().slice(0, 300),
    }))
    .filter((message) => message.content);
  if (!messages.length) throw new Response(null, { status: 400 });
  const criteria = input?.criteria && typeof input.criteria === "object" && !Array.isArray(input.criteria)
    ? input.criteria
    : {};
  return { messages, criteria };
}

async function upstream(path, init, env) {
  const base = normalizedBase(env.AGENT_CORE_BASE_URL);
  const key = String(env.AGENT_CORE_TENANT_KEY || "").trim();
  if (!base || !key || base.endsWith("example.invalid")) throw new Error("not_configured");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${key}`,
      "content-type": "application/json; charset=utf-8",
    },
  });
  if (!response.ok) {
    const error = new Error(`upstream_${response.status}`);
    error.status = response.status;
    error.path = path;
    error.retryAfter = safeRetryAfter(response.headers.get("retry-after"));
    throw error;
  }
  return response.json();
}

function invalidSearchRequest() {
  const error = new Error("invalid_search_request");
  error.status = 400;
  throw error;
}

function invalidSearchContract() {
  const error = new Error("invalid_search_contract");
  error.status = 502;
  throw error;
}

function requestConditions(value, accepts) {
  if (!Array.isArray(value) || value.length > 50) invalidSearchRequest();
  const output = value.map(contractCondition);
  if (output.some((condition) => !condition || !accepts(condition))) invalidSearchRequest();
  return output;
}

function searchContractRequest(input, env) {
  const hasWrappedContract = Boolean(input && typeof input === "object"
    && Object.hasOwn(input, "search_contract"));
  const hasDirectContract = Boolean(input && typeof input === "object"
    && Object.hasOwn(input, "contract_version"));
  if (hasWrappedContract && (!input.search_contract || typeof input.search_contract !== "object"
    || Array.isArray(input.search_contract))) invalidSearchRequest();
  const supplied = hasWrappedContract ? input.search_contract : (hasDirectContract ? input : null);
  if (supplied) {
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)
      || Object.keys(supplied).some((key) => !SEARCH_V2_REQUEST_FIELDS.has(key))
      || SEARCH_V2_REQUIRED_FIELDS.some((key) => !Object.hasOwn(supplied, key))
      || supplied.contract_version !== SEARCH_CONTRACT_VERSION) {
      invalidSearchRequest();
    }
    const productIdentity = contractCondition(supplied.product_identity);
    if (!isProductIdentityCondition(productIdentity)) invalidSearchRequest();
    if (!Number.isInteger(supplied.limit) || supplied.limit < 1 || supplied.limit > MAX_RESULTS) {
      invalidSearchRequest();
    }
    if (supplied.cursor !== undefined && supplied.cursor !== null
      && (typeof supplied.cursor !== "string" || supplied.cursor.length > 1000)) {
      invalidSearchRequest();
    }
    const limit = upstreamPageSize(supplied.limit, env);
    return {
      contract_version: SEARCH_CONTRACT_VERSION,
      product_identity: productIdentity,
      hard_constraints: requestConditions(supplied.hard_constraints, isHardConstraint),
      soft_context: requestConditions(supplied.soft_context, isSoftContext),
      transaction_context: requestConditions(supplied.transaction_context, isTransactionContext),
      limit,
      cursor: supplied.cursor === undefined || supplied.cursor === null || supplied.cursor === ""
        ? null : supplied.cursor,
    };
  }
  const query = String(input?.q || "").trim().slice(0, 300);
  if (!query) invalidSearchRequest();
  return {
    contract_version: SEARCH_CONTRACT_VERSION,
    product_identity: {
      name: "product_identity",
      value: query,
      source: "explicit",
      scope: "product",
      hardness: "hard",
    },
    hard_constraints: [],
    soft_context: [],
    transaction_context: [],
    limit: upstreamPageSize(input?.topK || input?.limit, env),
    cursor: input?.cursor ? String(input.cursor).slice(0, 1000) : null,
  };
}

function storefrontSearchContract(payload, env, effectiveLimit) {
  const status = String(payload?.status || "").toLowerCase();
  const intent = payload?.normalized_intent;
  const productIdentity = contractCondition(intent?.product_identity);
  const traceId = String(payload?.trace_id || "").trim();
  if (String(payload?.contract_version || "") !== SEARCH_CONTRACT_VERSION
    || !SEARCH_STATUSES.has(status)
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(traceId)
    || !isProductIdentityCondition(productIdentity)) invalidSearchContract();
  const limit = Math.min(Math.max(Number(effectiveLimit) || 1, 1), MAX_RESULTS);
  if (!Array.isArray(payload?.results) || payload.results.length > limit) invalidSearchContract();
  const conditionGroups = [intent?.hard_constraints, intent?.soft_context, intent?.transaction_context];
  const publicConditionGroups = conditionGroups.map(publicConditions);
  if (conditionGroups.some((group, index) => !Array.isArray(group) || group.length > 50
    || publicConditionGroups[index].length !== group.length)) invalidSearchContract();
  const groupValidators = [isHardConstraint, isSoftContext, isTransactionContext];
  if (publicConditionGroups.some((group, index) => group.some(
    (condition) => !groupValidators[index](condition),
  ))) invalidSearchContract();
  if (!Array.isArray(payload?.relaxations) || payload.relaxations.length > 100) invalidSearchContract();
  const relaxations = publicRelaxations(payload.relaxations);
  if (relaxations.length !== payload.relaxations.length) invalidSearchContract();
  if (!Array.isArray(payload?.missing_criteria) || payload.missing_criteria.length > 50) {
    invalidSearchContract();
  }
  const missingCriteria = payload.missing_criteria
    .map((item) => String(item).trim().toLowerCase());
  if (missingCriteria.some((item) => !/^[a-z][a-z0-9_]{0,63}$/.test(item))) invalidSearchContract();
  const upstreamResults = payload.results;
  if (upstreamResults.some((product) => !String(product?.title || "").trim())) {
    invalidSearchContract();
  }
  const results = upstreamResults
    .slice(0, MAX_RESULTS)
    .map((product) => storefrontProduct(product, env));
  if ((status === "results" && !results.length) || (status === "no_match" && results.length)) {
    invalidSearchContract();
  }
  const pagination = payload?.pagination;
  const searchScope = payload?.search_scope;
  const requiredScopeBooleans = [
    "plan_complete", "scope_exhausted", "global_catalog_exhaustive", "scan_limit_reached", "degraded",
  ];
  if (!pagination || typeof pagination !== "object" || Array.isArray(pagination)
    || !Number.isInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > limit
    || ![null, "string"].includes(pagination.cursor === null ? null : typeof pagination.cursor)
    || ![null, "string"].includes(pagination.next_cursor === null ? null : typeof pagination.next_cursor)
    || (typeof pagination.cursor === "string" && pagination.cursor.length > 1000)
    || (typeof pagination.next_cursor === "string" && pagination.next_cursor.length > 1000)
    || typeof pagination.has_more !== "boolean"
    || !searchScope || typeof searchScope !== "object" || Array.isArray(searchScope)
    || requiredScopeBooleans.some((key) => typeof searchScope[key] !== "boolean")) {
    invalidSearchContract();
  }
  if (results.length > pagination.limit) invalidSearchContract();
  const hasNextCursor = typeof pagination.next_cursor === "string" && Boolean(pagination.next_cursor);
  if (pagination.has_more !== hasNextCursor) invalidSearchContract();
  if ((status === "no_match" && (searchScope.plan_complete !== true
      || searchScope.scope_exhausted !== true || searchScope.scan_limit_reached !== false
      || searchScope.degraded !== false || pagination.has_more !== false))
    || (status === "degraded" && searchScope.degraded !== true)
    || (status !== "degraded" && searchScope.degraded !== false)) {
    invalidSearchContract();
  }
  return {
    contract_version: SEARCH_CONTRACT_VERSION,
    trace_id: traceId,
    status,
    normalized_intent: {
      product_identity: productIdentity,
      hard_constraints: publicConditionGroups[0],
      soft_context: publicConditionGroups[1],
      transaction_context: publicConditionGroups[2],
    },
    relaxations,
    missing_criteria: missingCriteria,
    results,
    pagination: {
      limit: pagination.limit,
      cursor: pagination.cursor ? String(pagination.cursor).slice(0, 1000) : null,
      next_cursor: pagination.next_cursor ? String(pagination.next_cursor).slice(0, 1000) : null,
      has_more: pagination.has_more === true,
    },
    search_scope: {
      plan_complete: searchScope.plan_complete === true,
      scope_exhausted: searchScope.scope_exhausted === true,
      global_catalog_exhaustive: searchScope.global_catalog_exhaustive === true,
      scan_limit_reached: searchScope.scan_limit_reached === true,
      degraded: searchScope.degraded === true,
      degraded_reason: searchScope.degraded_reason
        ? String(searchScope.degraded_reason).slice(0, 200) : null,
    },
  };
}

function validPublicImage(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !url.search && !url.hash && publicDnsHostname(url.hostname) ? url.href : "";
  } catch {
    return "";
  }
}

function validRuntimePrice(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = new Set(["amount", "currency", "tier"]);
  return Object.keys(value).every((field) => fields.has(field))
    && Object.hasOwn(value, "amount") && Object.hasOwn(value, "currency")
    && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount >= 0
    && typeof value.currency === "string" && /^[A-Z]{3}$/u.test(value.currency)
    && (value.tier === undefined || (typeof value.tier === "string" && value.tier.length <= 80));
}

function validRuntimeImages(value) {
  if (!Array.isArray(value) || value.length > 20) return false;
  return value.every((image) => {
    if (!image || typeof image !== "object" || Array.isArray(image)) return false;
    const fields = new Set(["url", "alt"]);
    return Object.keys(image).every((field) => fields.has(field))
      && typeof image.url === "string" && image.url.length <= 2_048
      && Boolean(validPublicImage(image.url))
      && (image.alt === undefined || (typeof image.alt === "string" && image.alt.length <= 300));
  });
}

function validRuntimeTags(value) {
  return Array.isArray(value) && value.length <= 50
    && value.every((item) => typeof item === "string" && item.length <= 100);
}

function validRuntimeAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length > 50
    || Object.keys(value).some((field) => !PUBLIC_PRODUCT_ATTRIBUTE_FIELDS.has(field))) return false;
  return Object.values(value).every((item) => (
    (typeof item === "string" && item.length <= 300)
      || (typeof item === "number" && Number.isFinite(item))
  ));
}

function validOptionalRuntimeProductFields(product) {
  return (product.category === undefined
      || (typeof product.category === "string" && product.category.length <= 200))
    && (product.tags === undefined || validRuntimeTags(product.tags))
    && (product.attributes === undefined || validRuntimeAttributes(product.attributes))
    && (product.availability_band === undefined || typeof product.availability_band === "string")
    && (product.lead_time_days === undefined
      || (Number.isInteger(product.lead_time_days) && product.lead_time_days >= 0))
    && (product.as_of === undefined
      || (typeof product.as_of === "string" && Number.isFinite(Date.parse(product.as_of))));
}

function validRuntimeProductShape(product, runtime, searchVerifiedAt) {
  if (!product || typeof product !== "object" || Array.isArray(product)
    || Object.keys(product).some((field) => !RUNTIME_PRODUCT_FIELDS.has(field))) return false;
  const handle = product.handle;
  const live = runtime.mode === "shopify_read_only";
  if (typeof product.public_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(product.public_id)
    || typeof handle !== "string" || !/^[a-z0-9-]{1,100}$/u.test(handle)
    || product.slug !== handle
    || typeof product.title !== "string" || !product.title.trim() || product.title.length > 300
    || (product.description !== undefined
      && (typeof product.description !== "string" || product.description.length > 5_000))
    || !validRuntimePrice(product.price)
    || !validRuntimeImages(product.images)
    || !validOptionalRuntimeProductFields(product)
    || typeof product.availableForSale !== "boolean"
    || product.purchasable !== false
    || product.non_transactional !== true
    || product.transaction_boundary !== "catalog_read_only_non_transactional"
    || product.writes !== false
    || product.mode !== runtime.mode
    || product.data_source !== runtime.data_source
    || product.illustrative_only !== !live
    || product.available !== false
    || Object.hasOwn(product, "add_to_cart_url")) return false;
  if (live) {
    return exactIsoTimestamp(product.shopify_verified_at)
      && product.shopify_verified_at === searchVerifiedAt
      && typeof product.product_url === "string";
  }
  return product.shopify_verified_at === null && !Object.hasOwn(product, "product_url")
    && product.availableForSale === false;
}

function runtimeProduct(product, runtime, searchVerifiedAt, env) {
  if (!validRuntimeProductShape(product, runtime, searchVerifiedAt)) {
    runtimeFailure("invalid_upstream_contract", 502, runtime);
  }
  const live = runtime.mode === "shopify_read_only";
  const origin = publicStorefrontOrigin(env?.STOREFRONT_ORIGIN);
  const productUrl = live
    ? verifiedShopifyProductUrl(product.product_url, product.handle, origin)
    : "";
  if (live && !productUrl) runtimeFailure("invalid_shopify_product_url", 502, runtime);
  const firstImage = product.images[0]?.url || "";
  return Object.freeze({
    public_id: product.public_id,
    handle: product.handle,
    title: product.title,
    summary: product.description || "",
    image: firstImage ? validPublicImage(firstImage) : "",
    price: Object.freeze({ amount: product.price.amount, currency: product.price.currency }),
    available_for_sale: live ? product.availableForSale : false,
    product_url: productUrl,
    shopify_verified_at: live ? product.shopify_verified_at : null,
    synthetic: !live,
    non_transactional: true,
    purchasable: false,
    writes: false,
    shipping_rates: false,
  });
}

function containsConfiguredRuntimeSecret(payload, env) {
  let serialized;
  try { serialized = JSON.stringify(payload); }
  catch { return true; }
  return [
    env?.AGENT_CORE_SANDBOX_INVITE,
    env?.AGENT_CORE_SANDBOX_TOKEN,
    env?.AGENT_CORE_TENANT_KEY,
    env?.SHOPIFY_APP_PROXY_SECRET,
  ].some((value) => {
    const secret = String(value || "");
    return secret.length >= 8 && serialized.includes(secret);
  });
}

function validateRuntimeSearchEnvelope(payload, runtime, env) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).some((field) => !RUNTIME_SEARCH_FIELDS.has(field))
    || RUNTIME_SEARCH_REQUIRED_FIELDS.some((field) => !Object.hasOwn(payload, field))
    || containsConfiguredRuntimeSecret(payload, env)) {
    runtimeFailure("invalid_upstream_contract", 502, runtime);
  }
  const intentFields = new Set([
    "product_identity", "hard_constraints", "soft_context", "transaction_context",
  ]);
  const relaxationFields = new Set(["condition", "from", "to", "reason"]);
  const paginationFields = new Set(["limit", "cursor", "next_cursor", "has_more"]);
  const scopeFields = new Set([
    "plan_complete", "scope_exhausted", "global_catalog_exhaustive", "scan_limit_reached",
    "degraded", "degraded_reason",
  ]);
  if (!exactObjectFields(payload.normalized_intent, intentFields)
    || !Array.isArray(payload.relaxations)
    || payload.relaxations.some((entry) => (
      !entry || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some((field) => !relaxationFields.has(field))
      || !Object.hasOwn(entry, "condition") || !Object.hasOwn(entry, "reason")
    ))
    || !exactObjectFields(payload.pagination, paginationFields)
    || !exactObjectFields(payload.search_scope, scopeFields)) {
    runtimeFailure("invalid_upstream_contract", 502, runtime);
  }
  const live = runtime.mode === "shopify_read_only";
  if (payload.mode !== runtime.mode
    || payload.data_source !== runtime.data_source
    || payload.illustrative_only !== !live
    || payload.purchasable !== false
    || payload.available !== false
    || payload.writes !== false
    || payload.non_transactional !== true
    || payload.transaction_boundary !== "catalog_read_only_non_transactional"
    || (live ? !exactIsoTimestamp(payload.shopify_verified_at) : payload.shopify_verified_at !== null)) {
    runtimeFailure("invalid_upstream_contract", 502, runtime);
  }
  if (payload.compatibility !== undefined) {
    const compatibilityFields = new Set(["adapter", "legacy_status"]);
    if (!exactObjectFields(payload.compatibility, compatibilityFields)
      || payload.compatibility.adapter !== "product_search_v1"
      || typeof payload.compatibility.legacy_status !== "string"
      || payload.compatibility.legacy_status.length > 100) {
      runtimeFailure("invalid_upstream_contract", 502, runtime);
    }
  }
}

function runtimeSearchContract(payload, runtime, env, effectiveLimit) {
  validateRuntimeSearchEnvelope(payload, runtime, env);
  // Reuse the established Search v2 semantic validator for normalized intent,
  // terminal states, pagination, and retrieval scope, then replace only its
  // legacy storefront result adapter with the closed read-run product shape.
  const base = storefrontSearchContract(payload, {}, effectiveLimit);
  const canonicalPairs = [
    [payload.contract_version, base.contract_version],
    [payload.trace_id, base.trace_id],
    [payload.status, base.status],
    [payload.normalized_intent, base.normalized_intent],
    [payload.relaxations, base.relaxations],
    [payload.missing_criteria, base.missing_criteria],
    [payload.pagination, base.pagination],
    [payload.search_scope, base.search_scope],
  ];
  if (canonicalPairs.some(([source, projected]) => !exactCanonicalValue(source, projected))) {
    runtimeFailure("invalid_upstream_contract", 502, runtime);
  }
  const results = payload.results.map((product) => (
    runtimeProduct(product, runtime, payload.shopify_verified_at, env)
  ));
  return Object.freeze({
    contract_version: base.contract_version,
    trace_id: base.trace_id,
    status: base.status,
    normalized_intent: base.normalized_intent,
    relaxations: base.relaxations,
    missing_criteria: base.missing_criteria,
    results: Object.freeze(results),
    pagination: base.pagination,
    search_scope: base.search_scope,
  });
}

export async function getRuntimeStatus(env) {
  const expectedMode = expectedRuntimeMode(env);
  const source = await sandboxUpstream("/sandbox/status", { method: "GET" }, env);
  if (containsConfiguredRuntimeSecret(source, env)) {
    runtimeFailure("invalid_upstream_contract", 502);
  }
  return projectRuntimeStatus(source, expectedMode);
}

export async function runServerDoctor(env) {
  const expectedMode = expectedRuntimeMode(env);
  const runtime = await getRuntimeStatus(env);
  const deployment = String(env?.BFF_DEPLOYMENT_MODE || "");
  const checks = Object.freeze({
    deployment_mode: deployment === "local" || deployment === "shopify_app_proxy",
    agent_core_status: runtime.connected,
    expected_mode: runtime.mode === expectedMode,
    credential_isolated: runtime.boundaries.credential_exposed === false,
    writes_disabled: runtime.writes_disabled === true,
  });
  return Object.freeze({
    contract: RUNTIME_DOCTOR_CONTRACT,
    ok: Object.values(checks).every(Boolean),
    runtime,
    checks,
  });
}

function unavailableRuntime(runtime) {
  const statusByState = {
    credential_missing: 503,
    authentication_failed: 502,
    permission_required: 502,
    quota_exceeded: 429,
    service_unavailable: 503,
  };
  runtimeFailure(runtime.credential_state, statusByState[runtime.credential_state] || 503, runtime);
}

function runtimeSearchInput(input) {
  const fields = new Set(["query", "limit", "cursor"]);
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((field) => !fields.has(field))) runtimeFailure("invalid_request", 400);
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 300) runtimeFailure("invalid_request", 400);
  if (input.limit !== undefined
    && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_RESULTS)) {
    runtimeFailure("invalid_request", 400);
  }
  if (input.cursor !== undefined && input.cursor !== null
    && (typeof input.cursor !== "string" || input.cursor.length > 1_000)) {
    runtimeFailure("invalid_request", 400);
  }
  return {
    q: query,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  };
}

export async function createReferenceStoreRun(request, env) {
  const input = runtimeSearchInput(await requestJson(request));
  const runtime = await getRuntimeStatus(env);
  if (!runtime.connected || !runtime.capabilities.catalog_search
    || !runtime.capabilities.search_contract_v2) unavailableRuntime(runtime);
  const contract = searchContractRequest(runtimeSearchInput({
    query: input.q,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  }), env);
  let source;
  try {
    source = await sandboxUpstream("/sandbox/api/search/v2", {
      method: "POST",
      body: JSON.stringify(contract),
    }, env);
  } catch (error) {
    if (error instanceof RuntimePublicError && !error.runtime) error.runtime = runtime;
    throw error;
  }
  const search = runtimeSearchContract(source, runtime, env, contract.limit);
  return Object.freeze({ contract: RUNTIME_RUN_CONTRACT, runtime, search });
}

async function handleChat(request, env) {
  const input = await requestJson(request);
  const payload = await upstream("/api/chat", { method: "POST", body: JSON.stringify(chatBody(input)) }, env);
  const products = Array.isArray(payload?.products)
    ? payload.products
    : Array.isArray(payload?.results) ? payload.results : [];
  return {
    session_id: sessionId(input?.session_id),
    requested_criteria: input?.criteria && typeof input.criteria === "object" ? input.criteria : {},
    criteria: payload?.criteria && typeof payload.criteria === "object" ? payload.criteria : {},
    criteria_evaluation: payload?.criteria_evaluation && typeof payload.criteria_evaluation === "object"
      ? payload.criteria_evaluation
      : {},
    next_cursor: String(payload?.next_cursor || ""),
    reply: String(payload?.reply || payload?.answer || "I could not find a confident catalog match.").slice(0, 8000),
    results: products.slice(0, MAX_RESULTS).map((product) => ({
      ...storefrontProduct(product, env),
      why: String(product?.why || product?.match_reason || "Open the product page to review current buying details.").slice(0, 500),
    })),
    next_actions: nextActions(payload?.next_actions),
    dynamic_request_recommended: payload?.dynamic_request_recommended === true,
    mode: String(payload?.mode || "connected_agent_core").slice(0, 60),
    live_agent_core: true,
  };
}

async function handleCatalog(request, env) {
  const input = await requestJson(request);
  const limit = upstreamPageSize(input?.limit, env);
  const params = new URLSearchParams({ limit: String(limit) });
  if (input?.cursor) params.set("cursor", String(input.cursor).slice(0, 500));
  const payload = await upstream(`/api/catalog?${params}`, { method: "GET" }, env);
  const products = Array.isArray(payload?.items) ? payload.items : [];
  return {
    products: products.map((product) => storefrontProduct(product, env)),
    nextCursor: String(payload?.next_cursor || payload?.nextCursor || ""),
  };
}

async function handleSearch(request, env) {
  const input = await requestJson(request);
  const contract = searchContractRequest(input, env);
  const payload = await upstream("/api/search/v2", {
    method: "POST",
    body: JSON.stringify(contract),
  }, env);
  return storefrontSearchContract(payload, env, contract.limit);
}

function runtimeErrorResponse(error, env, headers) {
  const configured = String(env?.BFF_RUNTIME_MODE || "").trim();
  const expected = RUNTIME_MODES.has(configured) ? configured : null;
  if (error instanceof Response) {
    const code = error.status === 413 ? "request_too_large" : "invalid_request";
    return json({ error: code, expected_mode: expected }, error.status, headers);
  }
  if (error instanceof RuntimePublicError) {
    const body = {
      error: error.code,
      expected_mode: expected,
      ...(error.runtime ? { runtime: error.runtime } : {}),
    };
    return json(body, error.status, {
      ...headers,
      ...(error.retryAfter ? { "retry-after": error.retryAfter } : {}),
    });
  }
  return json({ error: "service_unavailable", expected_mode: expected }, 503, headers);
}

async function handleRuntimeRoute(request, env, pathname) {
  const release = acquireRuntimeQuota(env);
  try {
    if (request.method === "GET" && pathname === "/api/runtime/status") {
      return await getRuntimeStatus(env);
    }
    if (request.method === "GET" && pathname === "/api/runtime/doctor") {
      return await runServerDoctor(env);
    }
    if (request.method === "POST" && pathname === "/api/runs") {
      return await createReferenceStoreRun(request, env);
    }
    runtimeFailure("not_found", 404);
  } finally {
    release();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const runtimePath = url.pathname === "/api/runtime/status"
      || url.pathname === "/api/runtime/doctor" || url.pathname === "/api/runs";
    const origin = allowedOrigin(request, env);
    if (origin === null) {
      return runtimePath
        ? runtimeErrorResponse(new RuntimePublicError("origin_not_allowed", 403), env, {})
        : json({ error: "origin_not_allowed" }, 403);
    }
    const headers = cors(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "cache-control": "no-store",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-max-age": "86400",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "send-from-china-storefront-bff" }, 200, headers);
    }
    const deploymentMode = String(env?.BFF_DEPLOYMENT_MODE || "").trim();
    const shopifyReadOnly = String(env?.BFF_RUNTIME_MODE || "").trim() === "shopify_read_only";
    const protectedApi = url.pathname.startsWith("/api/")
      && (runtimePath || deploymentMode || shopifyReadOnly);
    if (protectedApi) {
      try {
        await authorizeRuntimeRequest(request, env);
      } catch (error) {
        return runtimeErrorResponse(error, env, headers);
      }
    }
    if (runtimePath) {
      try {
        const payload = await handleRuntimeRoute(request, env, url.pathname);
        return json(payload, 200, headers);
      } catch (error) {
        return runtimeErrorResponse(error, env, headers);
      }
    }
    if (shopifyReadOnly && url.pathname.startsWith("/api/")) {
      return runtimeErrorResponse(new RuntimePublicError("not_found", 404), env, headers);
    }
    let releaseLegacyQuota = () => {};
    if (deploymentMode) {
      try {
        releaseLegacyQuota = acquireRuntimeQuota(env);
      } catch (error) {
        return runtimeErrorResponse(error, env, headers);
      }
    }

    try {
      if (request.method !== "POST") return json({ error: "not_found" }, 404, headers);
      let payload;
      if (url.pathname === "/api/chat") payload = await handleChat(request, env);
      else if (url.pathname === "/api/search") payload = await handleSearch(request, env);
      else if (url.pathname === "/api/catalog") payload = await handleCatalog(request, env);
      else return json({ error: "not_found" }, 404, headers);
      return json(payload, 200, headers);
    } catch (error) {
      if (error instanceof Response) {
        const code = error.status === 413 ? "request_too_large" : "invalid_request";
        return json({ error: code }, error.status, headers);
      }
      if (error?.message === "not_configured") {
        return json({ error: "service_not_configured" }, 503, headers);
      }
      if (error?.status === 429) {
        return json({ error: "rate_limited" }, 429, {
          ...headers,
          ...(error.retryAfter ? { "retry-after": error.retryAfter } : {}),
        });
      }
      if (error?.message === "invalid_search_request") {
        return json({ error: "invalid_search_request" }, 400, headers);
      }
      const searchUpstreamError = error?.path === "/api/search/v2";
      if (searchUpstreamError && error?.status === 400) {
        return json({ error: "invalid_search_request" }, 400, headers);
      }
      if (error?.message === "invalid_search_contract") {
        return json({ error: "invalid_upstream_contract" }, 502, headers);
      }
      if (searchUpstreamError && [401, 403].includes(error?.status)) {
        return json({ error: "upstream_authentication_failed" }, 502, headers);
      }
      if (searchUpstreamError && error?.status === 404) {
        return json({ error: "search_contract_not_supported" }, 502, headers);
      }
      return json({ error: "upstream_unavailable" }, 502, headers);
    } finally {
      releaseLegacyQuota();
    }
  },
};
