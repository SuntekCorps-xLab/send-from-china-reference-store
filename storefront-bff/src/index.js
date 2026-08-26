const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 12;
const MAX_RESULTS = 50;
const SEARCH_CONTRACT_VERSION = "2.0";
const SEARCH_STATUSES = new Set(["results", "needs_clarification", "no_match", "degraded"]);
const CONDITION_SOURCES = new Set(["explicit", "inferred", "default"]);
const CONDITION_SCOPES = new Set(["product", "session", "transaction"]);
const CONDITION_HARDNESS = new Set(["hard", "soft", "informational"]);

function upstreamPageSize(requested, env) {
  const configured = Number(env.AGENT_CORE_PAGE_SIZE || 20);
  const ceiling = Number.isInteger(configured) && configured >= 1 && configured <= MAX_RESULTS ? configured : 20;
  return Math.min(Math.max(Number(requested) || ceiling, 1), ceiling);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
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

function publicCondition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const name = String(value.name || "").trim().toLowerCase();
  const source = String(value.source || "");
  const scope = String(value.scope || "");
  const hardness = String(value.hardness || "");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(name)
    || !CONDITION_SOURCES.has(source)
    || !CONDITION_SCOPES.has(scope)
    || !CONDITION_HARDNESS.has(hardness)) return null;
  const values = Array.isArray(value.value) ? value.value.slice(0, 50) : [value.value];
  if (!values.length || values.some((item) => !["string", "number", "boolean"].includes(typeof item))) return null;
  const cleaned = values.map((item) => typeof item === "string" ? item.trim().slice(0, 300) : item);
  if (cleaned.some((item) => (typeof item === "string" && !item) || (typeof item === "number" && !Number.isFinite(item)))) {
    return null;
  }
  return { name, value: Array.isArray(value.value) ? cleaned : cleaned[0], source, scope, hardness };
}

function publicConditions(value) {
  return (Array.isArray(value) ? value : []).slice(0, 50).map(publicCondition).filter(Boolean);
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
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Response(null, { status: 413 });
  try {
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
    error.retryAfter = response.headers.get("retry-after") || "";
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

function requestConditions(value) {
  if (!Array.isArray(value) || value.length > 50) invalidSearchRequest();
  const output = value.map(publicCondition);
  if (output.some((condition) => !condition)) invalidSearchRequest();
  return output;
}

function searchContractRequest(input, env) {
  const supplied = input?.search_contract && typeof input.search_contract === "object"
    ? input.search_contract
    : input?.contract_version ? input : null;
  if (supplied) {
    if (String(supplied.contract_version || "") !== SEARCH_CONTRACT_VERSION) {
      invalidSearchRequest();
    }
    const productIdentity = publicCondition(supplied.product_identity);
    if (!productIdentity
      || productIdentity.name !== "product_identity"
      || productIdentity.scope !== "product"
      || productIdentity.hardness !== "hard"
      || typeof productIdentity.value !== "string") invalidSearchRequest();
    const limit = upstreamPageSize(supplied.limit, env);
    return {
      contract_version: SEARCH_CONTRACT_VERSION,
      product_identity: productIdentity,
      hard_constraints: requestConditions(supplied.hard_constraints),
      soft_context: requestConditions(supplied.soft_context),
      transaction_context: requestConditions(supplied.transaction_context),
      limit,
      cursor: supplied.cursor === undefined || supplied.cursor === null || supplied.cursor === ""
        ? null : String(supplied.cursor).slice(0, 1000),
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
  const productIdentity = publicCondition(intent?.product_identity);
  const traceId = String(payload?.trace_id || "").trim();
  if (String(payload?.contract_version || "") !== SEARCH_CONTRACT_VERSION
    || !SEARCH_STATUSES.has(status)
    || !/^[A-Za-z0-9._:-]{1,200}$/.test(traceId)
    || !productIdentity) invalidSearchContract();
  const limit = Math.min(Math.max(Number(effectiveLimit) || 1, 1), MAX_RESULTS);
  if (!Array.isArray(payload?.results) || payload.results.length > limit) invalidSearchContract();
  const conditionGroups = [intent?.hard_constraints, intent?.soft_context, intent?.transaction_context];
  const publicConditionGroups = conditionGroups.map(publicConditions);
  if (conditionGroups.some((group, index) => !Array.isArray(group) || group.length > 50
    || publicConditionGroups[index].length !== group.length)) invalidSearchContract();
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (origin === null) return json({ error: "origin_not_allowed" }, 403);
    const headers = cors(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-max-age": "86400",
        },
      });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "send-from-china-storefront-bff" }, 200, headers);
    }
    if (request.method !== "POST") return json({ error: "not_found" }, 404, headers);

    try {
      let payload;
      if (url.pathname === "/api/chat") payload = await handleChat(request, env);
      else if (url.pathname === "/api/search") payload = await handleSearch(request, env);
      else if (url.pathname === "/api/catalog") payload = await handleCatalog(request, env);
      else return json({ error: "not_found" }, 404, headers);
      return json(payload, 200, { ...headers, "cache-control": "no-store" });
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
    }
  },
};
