const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 12;
const MAX_RESULTS = 20;

function upstreamPageSize(requested, env) {
  const configured = Number(env.AGENT_CORE_PAGE_SIZE || 5);
  const ceiling = Number.isInteger(configured) && configured >= 1 && configured <= MAX_RESULTS ? configured : 5;
  return Math.min(Math.max(Number(requested) || ceiling, 1), ceiling);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function normalizedBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
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
    return url.protocol === "https:" ? url.href : "";
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
  const store = normalizedBase(env.STOREFRONT_ORIGIN);
  const price = product?.price && typeof product.price === "object"
    ? product.price
    : { amount: product?.price, currency: product?.currency };
  const amount = Number(price?.amount);
  const availability = String(product?.availability_band || "").toLowerCase();
  const productUrl = safeUrl(product?.product_url || product?.url)
    || (store && slug ? `${store}/products/${encodeURIComponent(slug)}` : "");
  return {
    public_id: String(product?.public_id || ""),
    handle: slug,
    title: String(product?.title || "Product").slice(0, 240),
    type: String(product?.category || product?.type || "").slice(0, 100),
    summary: String(product?.description || product?.summary || "").slice(0, 500),
    image: productImage(product) || safeUrl(product?.image),
    url: productUrl,
    product_url: productUrl,
    price: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: /^[A-Z]{3}$/.test(String(price?.currency || "").toUpperCase())
      ? String(price.currency).toUpperCase()
      : null,
    available: product?.purchasable === true && availability !== "out_of_stock",
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
      // Agent Core 0.4 accepts a maximum 300-character query. Bound every
      // forwarded turn so the final user message cannot be rejected upstream.
      content: String(message?.content || "").trim().slice(0, 300),
    }))
    .filter((message) => message.content);
  if (!messages.length) throw new Response(null, { status: 400 });
  return { messages };
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
    error.retryAfter = response.headers.get("retry-after") || "";
    throw error;
  }
  return response.json();
}

async function handleChat(request, env) {
  const input = await requestJson(request);
  const payload = await upstream("/api/chat", { method: "POST", body: JSON.stringify(chatBody(input)) }, env);
  const products = Array.isArray(payload?.products)
    ? payload.products
    : Array.isArray(payload?.results) ? payload.results : [];
  return {
    session_id: sessionId(input?.session_id),
    criteria: input?.criteria && typeof input.criteria === "object" ? input.criteria : {},
    next_cursor: String(payload?.next_cursor || ""),
    reply: String(payload?.reply || payload?.answer || "I could not find a confident catalog match.").slice(0, 8000),
    results: products.slice(0, MAX_RESULTS).map((product) => ({
      ...storefrontProduct(product, env),
      why: String(product?.why || product?.match_reason || "Open the product page to review current buying details.").slice(0, 500),
    })),
    next_actions: nextActions(payload?.next_actions),
    dynamic_request_recommended: payload?.dynamic_request_recommended === true,
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
  const query = String(input?.q || "").trim().slice(0, 500);
  if (!query) throw new Response(null, { status: 400 });
  const limit = upstreamPageSize(input?.topK || input?.limit, env);
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const payload = await upstream(`/api/search?${params}`, { method: "GET" }, env);
  const products = Array.isArray(payload?.items) ? payload.items : [];
  return { results: products.map((product) => storefrontProduct(product, env)) };
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
      return json({ error: "upstream_unavailable" }, 502, headers);
    }
  },
};
