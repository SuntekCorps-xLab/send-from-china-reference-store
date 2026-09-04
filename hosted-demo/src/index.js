import {
  simulatedRun,
  simulatedRuntimeDoctor,
  simulatedRuntimeStatus,
} from "../../demo/fixtures/platform-v1.mjs";

const MAX_BODY_BYTES = 32 * 1024;
const API_PATHS = new Set([
  "/api/runtime/status",
  "/api/runtime/doctor",
  "/api/runs",
]);
const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
});

function responseHeaders(type = "application/json; charset=utf-8") {
  return {
    ...SECURITY_HEADERS,
    "cache-control": "no-store",
    "content-type": type,
  };
}

function json(body, status = 200, extra = {}) {
  return Response.json(body, {
    status,
    headers: { ...responseHeaders(), ...extra },
  });
}

function methodNotAllowed(allow) {
  return json({ error: "method_not_allowed" }, 405, { allow });
}

async function strictJson(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
    throw new RangeError("request_too_large");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new RangeError("request_too_large");
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("invalid_request");
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    return value;
  } catch {
    throw new TypeError("invalid_request");
  }
}

function securedAsset(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  headers.set("cache-control", "no-store");
  headers.delete("set-cookie");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.username || url.password || url.search || url.hash) {
      return json({ error: "invalid_request" }, 400);
    }

    if (url.pathname === "/api/runtime/status") {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
      const response = json(simulatedRuntimeStatus());
      return request.method === "HEAD" ? new Response(null, response) : response;
    }
    if (url.pathname === "/api/runtime/doctor") {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
      const response = json(simulatedRuntimeDoctor());
      return request.method === "HEAD" ? new Response(null, response) : response;
    }
    if (url.pathname === "/api/runs") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      try {
        const run = simulatedRun(await strictJson(request));
        return run ? json(run) : json({ error: "invalid_request" }, 400);
      } catch (error) {
        return error instanceof RangeError
          ? json({ error: "request_too_large" }, 413)
          : json({ error: "invalid_request" }, 400);
      }
    }
    if (url.pathname.startsWith("/api/") || API_PATHS.has(url.pathname)) {
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed("GET, HEAD");
    if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return json({ error: "static_assets_unavailable" }, 503);
    }
    return securedAsset(await env.ASSETS.fetch(request));
  },
};
