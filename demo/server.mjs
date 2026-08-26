import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import storefrontBff from "../storefront-bff/src/index.js";
import {
  simulatedChat,
  simulatedSearch,
  simulatedStatus,
} from "./fixtures/platform-v1.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 32 * 1024;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const securityHeaders = {
  "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const sandboxBoundaries = Object.freeze({
  synthetic: true,
  illustrative: true,
  purchasable: false,
  commerce_writes: false,
  shipping_rates: false,
});

function sendJson(response, body, status = 200, headers = {}) {
  response.writeHead(status, {
    ...securityHeaders,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function sendText(response, body, status = 200, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, { ...securityHeaders, "content-type": contentType });
  response.end(body);
}

async function requestBody(request) {
  const declared = Number(request.headers["content-length"] || 0);
  if (declared > MAX_BODY_BYTES) {
    const error = new Error("request_too_large");
    error.status = 413;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request_too_large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const error = new Error("invalid_json");
    error.status = 400;
    throw error;
  }
}

async function jsonObject(response, maximumBytes = 16 * 1024) {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function requestJsonWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { response, payload: await jsonObject(response) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeConnectedSandbox(env, timeoutMs = 1500) {
  const base = env.AGENT_CORE_BASE_URL;
  const unavailable = {
    configured: true,
    reachable: false,
    sandbox_identity_verified: false,
    auth_verified: false,
    verified: false,
    readiness: "unavailable",
    reason: "agent_core_unreachable",
  };
  let identityResponse;
  let identity;
  try {
    ({ response: identityResponse, payload: identity } = await requestJsonWithTimeout(`${base}/sandbox/status`, {
      headers: { accept: "application/json" },
    }, timeoutMs));
  } catch {
    return unavailable;
  }

  const expectedBoundary = "synthetic-fixture; no-shipping-rates; no-commerce-writes";
  const identityVerified = identityResponse.ok
    && identityResponse.headers.get("x-send-from-china-sandbox-mode") === "synthetic_local_sandbox"
    && identityResponse.headers.get("x-send-from-china-sandbox-boundary") === expectedBoundary
    && identity?.mode === "synthetic_local_sandbox"
    && identity?.data_source === "synthetic_fixture"
    && identity?.purchasable === false
    && identity?.shipping_rates === false
    && identity?.commerce_writes === false
    && identity?.credential_exposed === false;
  if (!identityVerified) {
    return {
      ...unavailable,
      reachable: true,
      readiness: "unverified",
      reason: "sandbox_identity_unverified",
    };
  }

  let authResponse;
  let authPayload;
  try {
    ({ response: authResponse, payload: authPayload } = await requestJsonWithTimeout(`${base}/api/search?q=sandbox-readiness&limit=1`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${env.AGENT_CORE_TENANT_KEY}`,
      },
    }, timeoutMs));
  } catch {
    return {
      ...unavailable,
      reachable: true,
      sandbox_identity_verified: true,
      reason: "agent_core_probe_failed",
    };
  }

  if ([401, 403].includes(authResponse.status)) {
    return {
      ...unavailable,
      reachable: true,
      sandbox_identity_verified: true,
      readiness: "authentication_failed",
      reason: "tenant_authentication_failed",
    };
  }
  const authVerified = authResponse.ok
    && authPayload?.mode === "published_snapshot"
    && Array.isArray(authPayload?.items);
  if (!authVerified) {
    return {
      ...unavailable,
      reachable: true,
      sandbox_identity_verified: true,
      readiness: authResponse.ok ? "unverified" : "unavailable",
      reason: authResponse.ok ? "authenticated_contract_unverified" : "agent_core_probe_failed",
    };
  }
  return {
    configured: true,
    reachable: true,
    sandbox_identity_verified: true,
    auth_verified: true,
    verified: true,
    readiness: "ready",
    reason: null,
  };
}

function publicConnectedStatus(readiness) {
  return {
    ok: readiness.verified === true,
    mode: "connected_local_sandbox",
    data_source: readiness.verified ? "agent_core_synthetic_snapshot" : "unverified_local_agent_core",
    live_agent_core: readiness.verified === true,
    configured: true,
    reachable: readiness.reachable === true,
    sandbox_identity_verified: readiness.sandbox_identity_verified === true,
    auth_verified: readiness.auth_verified === true,
    verified: readiness.verified === true,
    readiness: readiness.readiness,
    reason: readiness.reason,
    synthetic: readiness.verified === true,
    illustrative: true,
    purchasable: false,
    commerce_writes: false,
    shipping_rates: false,
  };
}

function readinessController(env, options = {}) {
  const timeoutMs = Math.min(Math.max(Number(options.readinessTimeoutMs) || 1500, 100), 5000);
  const cacheMs = Math.min(Math.max(Number(options.readinessCacheMs) || 2000, 0), 10_000);
  let cached;
  let cachedAt = 0;
  let pending;
  return {
    async check(force = false) {
      if (!force && cached && Date.now() - cachedAt <= cacheMs) return cached;
      if (pending) return pending;
      pending = probeConnectedSandbox(env, timeoutMs)
        .then((value) => {
          cached = value;
          cachedAt = Date.now();
          return value;
        })
        .finally(() => { pending = null; });
      return pending;
    },
  };
}

function lockedProduct(product) {
  return {
    ...(product && typeof product === "object" ? product : {}),
    match_status: "illustrative_only",
    synthetic: true,
    illustrative: true,
    available: false,
    purchasable: false,
    product_url: "",
    browse_url: "",
    url: "",
    add_to_cart_url: "",
    purchase_handoff: null,
    shipping_rates: false,
  };
}

function lockConnectedPayload(payload) {
  const output = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload } : {};
  if (Array.isArray(output.results)) output.results = output.results.map(lockedProduct);
  if (Array.isArray(output.products)) output.products = output.products.map(lockedProduct);
  return {
    ...output,
    mode: "connected_local_sandbox",
    data_source: "agent_core_synthetic_snapshot",
    live_agent_core: true,
    verified: true,
    request_succeeded: true,
    boundaries: { ...sandboxBoundaries },
  };
}

function localAgentCoreBase(value) {
  try {
    const url = new URL(String(value || "").trim());
    const loopback = url.hostname === "localhost"
      || url.hostname === "[::1]"
      || url.hostname === ["127", "0", "0", "1"].join(".");
    if (!loopback || !["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return "";
    return url.href.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function connectedConfiguration(options) {
  const configuredBaseUrl = String(options.agentCoreBaseUrl || "").trim();
  const token = String(options.agentCoreToken || "").trim();
  if (!configuredBaseUrl || !token) throw new Error("connected_mode_requires_agent_core");
  const baseUrl = localAgentCoreBase(configuredBaseUrl);
  if (!baseUrl) throw new Error("connected_mode_requires_loopback_agent_core");
  return {
    AGENT_CORE_BASE_URL: baseUrl,
    AGENT_CORE_TENANT_KEY: token,
    AGENT_CORE_PAGE_SIZE: String(options.agentCorePageSize || "20"),
    STOREFRONT_ORIGIN: String(options.storefrontOrigin || "https://sandbox-store.example.invalid"),
    ALLOWED_ORIGINS: String(options.allowedOrigins || ""),
  };
}

async function connectedRequest(request, pathname, rawBody, env) {
  const headers = { "content-type": request.headers["content-type"] || "application/json" };
  if (request.headers.origin) headers.origin = request.headers.origin;
  const bffResponse = await storefrontBff.fetch(new Request(`https://local-bff.example.invalid${pathname}`, {
    method: request.method,
    headers,
    body: rawBody,
  }), env);
  let payload;
  try {
    payload = await bffResponse.json();
  } catch {
    payload = { error: "upstream_unavailable" };
  }
  const body = bffResponse.ok
    ? lockConnectedPayload(payload)
    : {
        ...payload,
        mode: "connected_local_sandbox",
        data_source: "agent_core_synthetic_snapshot",
        live_agent_core: false,
        verified: true,
        request_succeeded: false,
        boundaries: { ...sandboxBoundaries },
      };
  return {
    body,
    status: bffResponse.status,
    headers: bffResponse.headers.get("retry-after")
      ? { "retry-after": bffResponse.headers.get("retry-after") }
      : {},
  };
}

function normalizedMode(value) {
  return value === "connected" || value === "connected_local_sandbox" ? "connected" : "simulated";
}

function loopbackHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (host === "localhost" || host === "::1" || host === ["127", "0", "0", "1"].join(".")) return host;
  throw new Error("demo_requires_loopback_host");
}

function createDemoServer(options = {}) {
  const mode = normalizedMode(options.mode);
  const connectedEnv = mode === "connected" ? connectedConfiguration(options) : null;
  const readiness = connectedEnv ? readinessController(connectedEnv, options) : null;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, { ok: true, service: "send-from-china-reference-demo", mode });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        const status = mode === "connected"
          ? publicConnectedStatus(await readiness.check())
          : simulatedStatus();
        sendJson(response, status);
        return;
      }

      const apiRoutes = new Set(["/api/chat", "/api/search"]);
      if (apiRoutes.has(url.pathname)) {
        if (request.method !== "POST") {
          sendJson(response, { error: "not_found" }, 404);
          return;
        }
        const rawBody = await requestBody(request);
        if (mode === "connected") {
          const connectedReadiness = await readiness.check();
          if (!connectedReadiness.verified) {
            sendJson(response, {
              error: "sandbox_not_ready",
              ...publicConnectedStatus(connectedReadiness),
            }, 503);
            return;
          }
          const result = await connectedRequest(request, url.pathname, rawBody, connectedEnv);
          sendJson(response, result.body, result.status, result.headers);
          return;
        }

        const payload = parseJson(rawBody);
        const result = url.pathname === "/api/chat"
          ? simulatedChat(payload)
          : simulatedSearch(payload);
        if (!result) {
          sendJson(response, { error: url.pathname === "/api/chat" ? "invalid_messages" : "invalid_search_request" }, 400);
          return;
        }
        sendJson(response, result);
        return;
      }

      if (url.pathname.startsWith("/api/") || url.pathname === "/mcp") {
        sendJson(response, { error: "not_found" }, 404);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        sendJson(response, { error: "not_found" }, 404);
        return;
      }
      const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!/^[a-zA-Z0-9._/-]+$/.test(relative) || relative.includes("..")) {
        sendText(response, "Not found", 404);
        return;
      }
      try {
        const file = await readFile(path.join(root, relative));
        response.writeHead(200, {
          ...securityHeaders,
          "content-type": types[path.extname(relative)] || "application/octet-stream",
          "cache-control": "no-cache",
        });
        response.end(request.method === "HEAD" ? undefined : file);
      } catch {
        sendText(response, "Not found", 404);
      }
    } catch (error) {
      const status = Number(error?.status) || 500;
      const code = status === 413 ? "request_too_large" : status === 400 ? String(error.message) : "demo_unavailable";
      sendJson(response, { error: code }, status);
    }
  });
  return {
    server,
    readiness,
    setAllowedOrigins(value) {
      if (connectedEnv) connectedEnv.ALLOWED_ORIGINS = String(value || "");
    },
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export async function startDemo(options = {}) {
  const host = loopbackHost(options.host || ["127", "0", "0", "1"].join("."));
  const port = Number(options.port ?? 4173);
  const mode = normalizedMode(options.mode);
  const originHost = host === "::1" ? "[::1]" : host;
  const controller = createDemoServer({
    ...options,
    mode,
    allowedOrigins: options.allowedOrigins || "",
  });
  const { server } = controller;
  await listen(server, port, host);
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const baseUrl = `http://${originHost}:${actualPort}`;
  controller.setAllowedOrigins(options.allowedOrigins
    || `http://${originHost}:${actualPort},http://localhost:${actualPort}`);
  if (mode === "connected" && options.verifyConnected === true) {
    const readiness = await controller.readiness.check(true);
    if (!readiness.verified) {
      await closeServer(server);
      throw new Error(`connected_sandbox_not_ready:${readiness.reason}`);
    }
  }
  let closed = false;
  return {
    server,
    baseUrl,
    mode,
    async close() {
      if (closed) return;
      closed = true;
      await closeServer(server);
    },
  };
}

function cliMode(args) {
  if (args.includes("--connected")) return "connected";
  const pair = args.find((argument) => argument.startsWith("--mode="));
  return normalizedMode(pair ? pair.slice("--mode=".length) : process.env.DEMO_MODE);
}

async function runCli() {
  const mode = cliMode(process.argv.slice(2));
  const runtime = await startDemo({
    mode,
    port: Number(process.env.DEMO_PORT || 4173),
    host: String(process.env.DEMO_HOST || "127.0.0.1"),
    agentCoreBaseUrl: process.env.AGENT_CORE_BASE_URL,
    agentCoreToken: process.env.AGENT_CORE_TENANT_KEY,
    storefrontOrigin: process.env.STOREFRONT_ORIGIN,
  });
  process.stdout.write(`Reference Store ${mode === "connected" ? "connected local sandbox" : "offline demo"}: ${runtime.baseUrl}\n`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.close();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    let message;
    if (error?.message === "connected_mode_requires_agent_core") {
      message = "Connected mode requires AGENT_CORE_BASE_URL and AGENT_CORE_TENANT_KEY in the server environment.";
    } else if (error?.message === "connected_mode_requires_loopback_agent_core") {
      message = "Connected demo mode accepts only a loopback Agent Core URL. Use storefront-bff/ for hosted deployments.";
    } else if (error?.message === "demo_requires_loopback_host") {
      message = "The demo is local-only and may bind only to 127.0.0.1, localhost, or ::1.";
    } else {
      message = `Reference Store demo failed: ${error?.message || "unknown_error"}`;
    }
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
