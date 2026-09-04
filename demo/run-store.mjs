const RUNTIME_FIELDS = new Set([
  "contract",
  "source_contract",
  "mode",
  "connected",
  "credential_state",
  "data_source",
  "api_version",
  "quota",
  "writes_disabled",
  "capabilities",
  "checked_at",
  "error_code",
  "boundaries",
]);

const QUOTA_FIELDS = new Set([
  "limit",
  "remaining",
  "window_seconds",
  "concurrency_limit",
  "reset_at",
]);

const CAPABILITY_FIELDS = new Set([
  "doctor",
  "catalog_search",
  "search_contract_v2",
  "product_detail",
  "storefront_health",
]);

const BOUNDARY_FIELDS = new Set([
  "non_transactional",
  "purchasable",
  "shipping_rates",
  "commerce_writes",
  "credential_exposed",
]);

const SEARCH_FIELDS = new Set([
  "contract_version",
  "trace_id",
  "status",
  "normalized_intent",
  "relaxations",
  "missing_criteria",
  "results",
  "pagination",
  "search_scope",
]);

const INTENT_FIELDS = new Set([
  "product_identity",
  "hard_constraints",
  "soft_context",
  "transaction_context",
]);

const CONDITION_FIELDS = new Set(["name", "value", "source", "scope", "hardness"]);
const PAGINATION_FIELDS = new Set(["limit", "cursor", "next_cursor", "has_more"]);
const SEARCH_SCOPE_FIELDS = new Set([
  "plan_complete",
  "scope_exhausted",
  "global_catalog_exhaustive",
  "scan_limit_reached",
  "degraded",
  "degraded_reason",
]);

const PRODUCT_FIELDS = new Set([
  "public_id",
  "handle",
  "title",
  "summary",
  "image",
  "price",
  "available_for_sale",
  "product_url",
  "shopify_verified_at",
  "synthetic",
  "non_transactional",
  "purchasable",
  "writes",
  "shipping_rates",
]);

const PRICE_FIELDS = new Set(["amount", "currency"]);
const RUN_FIELDS = new Set(["contract", "runtime", "search"]);
const LIVE_FAILURES = Object.freeze({
  credential_missing: "CREDENTIAL_MISSING",
  authentication_failed: "AUTHENTICATION_FAILED",
  permission_required: "PERMISSION_REQUIRED",
  quota_exceeded: "QUOTA_EXCEEDED",
  service_unavailable: "SERVICE_UNAVAILABLE",
});

function fail(code) {
  throw new TypeError(code);
}

function exactObject(value, fields) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === fields.size
    && Object.keys(value).every((key) => fields.has(key));
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function privateOrIpHostname(value) {
  const hostname = String(value || "").toLowerCase().replace(/^\[|\]$/gu, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname.endsWith(".local") || hostname.endsWith(".internal")
    || hostname.endsWith(".corp") || hostname.endsWith(".lan")
    || hostname.endsWith(".localdomain") || hostname.endsWith(".home.arpa")) return true;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname) || hostname.includes(":");
}

function publicDnsHostname(value) {
  const hostname = String(value || "").toLowerCase();
  return !privateOrIpHostname(hostname)
    && !hostname.endsWith(".")
    && hostname.length <= 253
    && hostname.includes(".")
    && hostname.split(".").every((label) => (
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
    ));
}

function safeHttpsUrl(value, { productHandle = null } = {}) {
  if (typeof value !== "string" || !value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || url.search || url.hash || !publicDnsHostname(url.hostname)) return null;
    if (productHandle !== null && url.pathname !== `/products/${productHandle}`) return null;
    return url;
  } catch {
    return null;
  }
}

function validateQuota(quota) {
  return exactObject(quota, QUOTA_FIELDS)
    && ["limit", "remaining", "window_seconds", "concurrency_limit"]
      .every((field) => nonNegativeInteger(quota[field]))
    && quota.remaining <= quota.limit
    && (quota.reset_at === null || exactIsoTimestamp(quota.reset_at));
}

function validateCapabilities(capabilities) {
  return exactObject(capabilities, CAPABILITY_FIELDS)
    && [...CAPABILITY_FIELDS].every((field) => typeof capabilities[field] === "boolean")
    && capabilities.doctor === true;
}

function validateBoundaries(boundaries) {
  return exactObject(boundaries, BOUNDARY_FIELDS)
    && boundaries.non_transactional === true
    && boundaries.purchasable === false
    && boundaries.shipping_rates === false
    && boundaries.commerce_writes === false
    && boundaries.credential_exposed === false;
}

export function validateRuntimeStatus(runtime) {
  if (!exactObject(runtime, RUNTIME_FIELDS)
    || runtime.contract !== "reference-store-runtime-status/v1"
    || runtime.source_contract !== "shopify-live-sandbox-status/v1"
    || !["synthetic_local_sandbox", "shopify_read_only"].includes(runtime.mode)
    || typeof runtime.connected !== "boolean"
    || !validateQuota(runtime.quota)
    || runtime.writes_disabled !== true
    || !validateCapabilities(runtime.capabilities)
    || !exactIsoTimestamp(runtime.checked_at)
    || !validateBoundaries(runtime.boundaries)) fail("invalid_runtime_status");

  const readCapabilities = [
    "catalog_search",
    "search_contract_v2",
    "product_detail",
    "storefront_health",
  ];
  if (runtime.mode === "synthetic_local_sandbox") {
    if (runtime.connected !== true
      || runtime.credential_state !== "mock_ready"
      || runtime.data_source !== "synthetic_fixture"
      || runtime.api_version !== null
      || runtime.error_code !== null
      || runtime.capabilities.catalog_search !== true
      || runtime.capabilities.search_contract_v2 !== true
      || runtime.capabilities.product_detail !== true
      || runtime.capabilities.storefront_health !== false) fail("invalid_runtime_status");
    return runtime;
  }

  if (runtime.data_source !== "shopify_storefront_graphql" || runtime.api_version !== "2026-07") {
    fail("invalid_runtime_status");
  }
  if (runtime.connected) {
    if (runtime.credential_state !== "succeeded" || runtime.error_code !== null
      || !readCapabilities.every((field) => runtime.capabilities[field] === true)) {
      fail("invalid_runtime_status");
    }
    return runtime;
  }
  if (runtime.error_code !== LIVE_FAILURES[runtime.credential_state]
    || !readCapabilities.every((field) => runtime.capabilities[field] === false)) {
    fail("invalid_runtime_status");
  }
  return runtime;
}

function scalar(value) {
  return typeof value === "string"
    ? Boolean(value.trim()) && value.length <= 300
    : (typeof value === "number" ? Number.isFinite(value) : typeof value === "boolean");
}

function validateCondition(condition) {
  if (!exactObject(condition, CONDITION_FIELDS)
    || typeof condition.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/u.test(condition.name)
    || !["explicit", "inferred", "default"].includes(condition.source)
    || !["product", "session", "transaction"].includes(condition.scope)
    || !["hard", "soft", "informational"].includes(condition.hardness)) return false;
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  return values.length >= 1 && values.length <= 50 && values.every(scalar);
}

function validateConditions(value) {
  return Array.isArray(value) && value.length <= 50 && value.every(validateCondition);
}

function validateRelaxations(value) {
  if (!Array.isArray(value) || value.length > 100) return false;
  const allowed = new Set(["condition", "reason", "from", "to"]);
  return value.every((item) => item && typeof item === "object" && !Array.isArray(item)
    && Object.keys(item).every((key) => allowed.has(key))
    && Object.hasOwn(item, "condition") && Object.hasOwn(item, "reason")
    && typeof item.condition === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(item.condition)
    && typeof item.reason === "string" && Boolean(item.reason.trim()) && item.reason.length <= 300
    && (!Object.hasOwn(item, "from") || scalar(item.from))
    && (!Object.hasOwn(item, "to") || scalar(item.to)));
}

function validatePrice(price) {
  return exactObject(price, PRICE_FIELDS)
    && typeof price.amount === "number" && Number.isFinite(price.amount) && price.amount >= 0
    && typeof price.currency === "string" && /^[A-Z]{3}$/u.test(price.currency);
}

function validateProduct(product, runtime) {
  if (!exactObject(product, PRODUCT_FIELDS)
    || typeof product.public_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(product.public_id)
    || typeof product.handle !== "string" || !/^[a-z0-9-]{1,100}$/u.test(product.handle)
    || typeof product.title !== "string" || !product.title.trim() || product.title.length > 300
    || typeof product.summary !== "string" || product.summary.length > 5_000
    || typeof product.image !== "string" || (product.image && !safeHttpsUrl(product.image))
    || !validatePrice(product.price)
    || typeof product.available_for_sale !== "boolean"
    || product.non_transactional !== true
    || product.purchasable !== false
    || product.writes !== false
    || product.shipping_rates !== false) return false;

  if (runtime.mode === "synthetic_local_sandbox") {
    return product.synthetic === true
      && product.available_for_sale === false
      && product.product_url === ""
      && product.shopify_verified_at === null;
  }
  return product.synthetic === false
    && Boolean(safeHttpsUrl(product.product_url, { productHandle: product.handle }))
    && exactIsoTimestamp(product.shopify_verified_at);
}

function validateNormalizedIntent(intent) {
  return exactObject(intent, INTENT_FIELDS)
    && validateCondition(intent.product_identity)
    && intent.product_identity.name === "product_identity"
    && intent.product_identity.source === "explicit"
    && intent.product_identity.scope === "product"
    && intent.product_identity.hardness === "hard"
    && validateConditions(intent.hard_constraints)
    && validateConditions(intent.soft_context)
    && validateConditions(intent.transaction_context);
}

function validatePagination(pagination) {
  return exactObject(pagination, PAGINATION_FIELDS)
    && Number.isInteger(pagination.limit) && pagination.limit >= 1 && pagination.limit <= 50
    && (pagination.cursor === null
      || (typeof pagination.cursor === "string" && pagination.cursor.length <= 1_000))
    && (pagination.next_cursor === null
      || (typeof pagination.next_cursor === "string" && pagination.next_cursor.length <= 1_000))
    && typeof pagination.has_more === "boolean"
    && pagination.has_more === (typeof pagination.next_cursor === "string" && Boolean(pagination.next_cursor));
}

function validateSearchScope(scope) {
  return exactObject(scope, SEARCH_SCOPE_FIELDS)
    && ["plan_complete", "scope_exhausted", "global_catalog_exhaustive", "scan_limit_reached", "degraded"]
      .every((field) => typeof scope[field] === "boolean")
    && (scope.degraded_reason === null
      || (typeof scope.degraded_reason === "string" && scope.degraded_reason.length <= 200));
}

function validateSearch(search, runtime) {
  if (!exactObject(search, SEARCH_FIELDS)
    || search.contract_version !== "2.0"
    || typeof search.trace_id !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/u.test(search.trace_id)
    || !["results", "needs_clarification", "no_match", "degraded"].includes(search.status)
    || !validateNormalizedIntent(search.normalized_intent)
    || !validateRelaxations(search.relaxations)
    || !Array.isArray(search.missing_criteria) || search.missing_criteria.length > 50
    || !search.missing_criteria.every((item) => (
      typeof item === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(item)
    ))
    || !Array.isArray(search.results) || search.results.length > 50
    || !search.results.every((product) => validateProduct(product, runtime))
    || !validatePagination(search.pagination)
    || !validateSearchScope(search.search_scope)
    || search.results.length > search.pagination.limit) fail("invalid_read_run");

  if ((search.status === "results" && search.results.length === 0)
    || (search.status === "no_match" && search.results.length !== 0)
    || (search.status === "degraded") !== search.search_scope.degraded) fail("invalid_read_run");
  if (runtime.mode === "shopify_read_only" && search.results.length > 1) {
    const origins = new Set(search.results.map((product) => new URL(product.product_url).origin));
    if (origins.size !== 1) fail("invalid_read_run");
  }
  return search;
}

export function validateReadRun(run) {
  if (!exactObject(run, RUN_FIELDS) || run.contract !== "reference-store-read-run/v1") {
    fail("invalid_read_run");
  }
  validateRuntimeStatus(run.runtime);
  if (run.runtime.connected !== true) fail("invalid_read_run");
  validateSearch(run.search, run.runtime);
  return run;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function freezeRuntimeStatus(parsedPayload) {
  validateRuntimeStatus(parsedPayload);
  return deepFreeze(parsedPayload);
}

export function freezeReadRun(parsedPayload) {
  validateReadRun(parsedPayload);
  return deepFreeze(parsedPayload);
}

export function createRunStore({ renderWorkbench, renderDrawer, renderReceipt }) {
  const renderers = { workbench: renderWorkbench, drawer: renderDrawer, receipt: renderReceipt };
  if (Object.values(renderers).some((renderer) => typeof renderer !== "function")) {
    throw new TypeError("invalid_run_renderer");
  }
  let activeRun = null;
  let lastRenderIdentity = Object.freeze({
    workbench: false,
    drawer: false,
    receipt: false,
    all: false,
  });

  function setActiveRun(parsedPayload) {
    const run = freezeReadRun(parsedPayload);
    activeRun = run;
    const received = {};
    for (const [name, renderer] of Object.entries(renderers)) {
      renderer(run);
      received[name] = run === activeRun;
    }
    lastRenderIdentity = Object.freeze({
      workbench: received.workbench,
      drawer: received.drawer,
      receipt: received.receipt,
      all: received.workbench && received.drawer && received.receipt,
    });
    return activeRun;
  }

  return Object.freeze({
    setActiveRun,
    getActiveRun: () => activeRun,
    getLastRenderIdentity: () => lastRenderIdentity,
  });
}
