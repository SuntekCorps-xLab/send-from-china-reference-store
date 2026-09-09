import assert from "node:assert/strict";
import test from "node:test";

import worker, { RUNTIME_PUBLIC_ERRORS } from "../src/index.js";
import {
  MANAGED_CATALOG_READ_TOOLS,
  canonicalManagedProductUrl,
  createAnonymousManagedMcpAdapter,
  validateManagedMcpDiscovery,
} from "../src/managed-public-catalog.js";

const STOREFRONT = "https://reference-store.example.invalid";
const ENDPOINT = "https://managed-catalog.example.invalid/mcp";
function product(handle, overrides = {}) {
  return {
    handle,
    title: `Synthetic ${handle}`,
    description: "Offline managed public catalog fixture.",
    price_usd: 18.5,
    currency: "USD",
    available: true,
    catalog_available: true,
    purchasable: false,
    purchase_status: "cart_verification_required",
    url: `https://catalog.example.invalid/products/${handle}`,
    image: "https://unlisted-images.example.invalid/fixture.jpg?token=never",
    variants: [{ add_to_cart_url: "javascript:alert(1)" }],
    ...overrides,
  };
}

function initializeEnvelope() {
  return {
    jsonrpc: "2.0", id: "synthetic-init",
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "world-products", version: "1.0.0" },
    },
  };
}

function toolsEnvelope() {
  const plain = (required = []) => ({
    type: "object", properties: { query: { type: "string" } }, ...(required.length ? { required } : {}),
  });
  return {
    jsonrpc: "2.0", id: "synthetic-tools",
    result: { tools: [
      {
        name: "product_search",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            criteria: { type: "object", properties: {}, additionalProperties: false },
            mode: { type: "string", enum: ["catalog", "recommendations"] },
            operation: { type: "string", enum: ["search", "confirm_search", "more"] },
          },
        },
      },
      { name: "search_catalog", inputSchema: plain(["query"]) },
      { name: "browse_catalog", inputSchema: plain() },
      { name: "ask_catalog", inputSchema: plain(["query"]) },
      {
        name: "get_product",
        inputSchema: { type: "object", properties: { handle: { type: "string" } }, required: ["handle"] },
      },
      {
        name: "create_product_request",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
      { name: "get_agent_access", inputSchema: plain() },
      { name: "create_sourcing_task", inputSchema: plain(["query"]) },
      { name: "get_sourcing_task", inputSchema: plain() },
      { name: "list_sourcing_results", inputSchema: plain() },
      { name: "request_storylab_governance", inputSchema: plain() },
    ] },
  };
}

function toolEnvelope(structuredContent, isError = false) {
  return {
    jsonrpc: "2.0", id: "synthetic-tool-call",
    result: { content: [{ type: "text", text: "Synthetic offline fixture" }], structuredContent, isError },
  };
}

function cohort(overrides = {}) {
  return {
    status: "accepted",
    reviewed_at: "2026-08-31T00:00:00.000Z",
    expires_at: "2099-08-31T00:00:00.000Z",
    handles: Array.from({ length: 20 }, (_, index) => `fixture-${String(index + 1).padStart(2, "0")}`),
    ...overrides,
  };
}

function environment(overrides = {}) {
  const supplied = overrides.MANAGED_CATALOG_ADAPTER || {};
  const defaultGetProduct = async ({ handle }) => product(handle);
  const defaultSearch = async ({ query }) => ({
    status: "results", mode: "catalog", degraded: false,
    results: [product("fixture-01", { title: query })], next_cursor: null,
  });
  const adapter = {
    initialize: supplied.initialize || (async () => initializeEnvelope()),
    listTools: supplied.listTools || (async () => toolsEnvelope()),
    callTool: supplied.callTool || (async (request) => {
      const operation = request.name === "get_product"
        ? supplied.getProduct || defaultGetProduct
        : supplied.search || defaultSearch;
      return toolEnvelope(await operation({ ...request, ...request.arguments }));
    }),
  };
  const env = {
    BFF_RUNTIME_MODE: "managed_public_catalog",
    BFF_DEPLOYMENT_MODE: "local",
    STOREFRONT_ORIGIN: STOREFRONT,
    ALLOWED_ORIGINS: STOREFRONT,
    MANAGED_CATALOG_ENABLED: "true",
    MANAGED_CATALOG_ENDPOINT: ENDPOINT,
    MANAGED_CATALOG_ALLOWED_ORIGIN: "https://managed-catalog.example.invalid",
    MANAGED_CATALOG_COHORT_PROVIDER: { load: async () => cohort() },
    MANAGED_CATALOG_ADAPTER: adapter,
    ...overrides,
  };
  env.MANAGED_CATALOG_ADAPTER = adapter;
  return env;
}

async function call(path, env, body) {
  const request = new Request(`http://127.0.0.1${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: STOREFRONT,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await worker.fetch(request, env);
  return { response, body: await response.json() };
}

function containsExactString(value, expected) {
  if (typeof value === "string") return value === expected;
  if (Array.isArray(value)) return value.some((item) => containsExactString(item, expected));
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some((item) => containsExactString(item, expected));
}

test("curated cohort is refreshed through the injected adapter with bounded concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const seenEndpoints = new Set();
  const env = environment({
    MANAGED_CATALOG_ADAPTER: {
      search: async () => ({ status: "no_match", mode: "catalog", degraded: false, results: [] }),
      getProduct: async ({ endpoint, handle }) => {
        seenEndpoints.add(endpoint);
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return product(handle);
      },
    },
  });
  const result = await call("/api/managed-catalog/curated", env);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.equal(result.response.headers.get("set-cookie"), null);
  assert.equal(result.body.contract, "reference-store-managed-public-catalog/v1");
  assert.equal(result.body.products.length, 20);
  assert.ok(result.body.products.every((item) => item.curated && item.quality_label === "curated_cohort_member"));
  assert.ok(maximum <= 4);
  assert.deepEqual([...seenEndpoints], [ENDPOINT]);
  assert.equal(containsExactString(result.body, ENDPOINT), false);
});

test("missing or rejected cohort fails closed without querying the adapter", async () => {
  let calls = 0;
  const result = await call("/api/managed-catalog/curated", environment({
    MANAGED_CATALOG_COHORT_PROVIDER: { load: async () => ({ status: "pending" }) },
    MANAGED_CATALOG_ADAPTER: {
      search: async () => { calls += 1; },
      getProduct: async () => { calls += 1; },
    },
  }));
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error, "curated_not_ready");
  assert.equal(calls, 0);
});

test("an incomplete curated refresh is reported only as curated not ready", async () => {
  const result = await call("/api/managed-catalog/curated", environment({
    MANAGED_CATALOG_ADAPTER: {
      search: async () => ({ status: "no_match", mode: "catalog", degraded: false, results: [] }),
      getProduct: async ({ handle }) => {
        if (handle === "fixture-04") throw new Error("offline detail unavailable");
        return product(handle);
      },
    },
  }));
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error, "curated_not_ready");
  assert.equal(Object.hasOwn(result.body, "products"), false);
});

test("managed endpoint requires one canonical HTTPS origin and exact MCP path", async () => {
  const invalidEndpoints = [
    "http://managed-catalog.example.invalid/mcp",
    "https://managed-catalog.example.invalid/mcp?token=never",
    "https://prefix.managed-catalog.example.invalid/mcp",
    "https://managed-catalog.example.invalid.evil.invalid/mcp",
    "https://evil.invalid/managed-catalog.example.invalid/mcp",
    "https://managed-catalog.example.invalid/prefix/mcp",
    "https://managed-catalog.example.invalid/mcp-extra",
    "https://user@managed-catalog.example.invalid/mcp",
    "https:\\managed-catalog.example.invalid\\mcp",
    "https://managed-catalog.example.invalid/%6dcp",
    "https://managed-catalog.example.invalid/safe/../mcp",
    "HTTPS://managed-catalog.example.invalid/mcp",
    " HTTPS://managed-catalog.example.invalid/mcp",
  ];
  for (const endpoint of invalidEndpoints) {
    let calls = 0;
    const result = await call("/api/managed-catalog/curated", environment({
      MANAGED_CATALOG_ENDPOINT: endpoint,
      MANAGED_CATALOG_ADAPTER: {
        search: async () => { calls += 1; },
        getProduct: async () => { calls += 1; },
      },
    }));
    assert.equal(result.response.status, 503, endpoint);
    assert.equal(result.body.error, "managed_catalog_not_configured", endpoint);
    assert.equal(calls, 0, endpoint);
  }
});

test("broader public search requires explicit opt-in and is never labelled curated", async () => {
  const denied = await call("/api/managed-catalog/search", environment(), {
    query: "desk organizer", scope: "broader_public_catalog",
  });
  assert.equal(denied.response.status, 400);
  assert.equal(denied.body.error, "broader_search_opt_in_required");

  const allowed = await call("/api/managed-catalog/search", environment(), {
    query: "desk organizer", scope: "broader_public_catalog", explicit_broader_search: true, limit: 1,
  });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.scope, "broader_public_catalog");
  assert.equal(allowed.body.broader_catalog_quality_verified, false);
  assert.equal(allowed.body.products[0].curated, false);
  assert.equal(allowed.body.products[0].quality_label, "broader_public_catalog_unreviewed");
});

test("product lookup refreshes one strict same-store canonical PDP", async () => {
  const result = await call("/api/managed-catalog/product", environment(), {
    handle: "fixture-01", scope: "curated",
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.products[0].product_url, `${STOREFRONT}/products/fixture-01`);
  assert.deepEqual(result.body.products[0].catalog_price, { amount: 18.5, currency: "USD" });
  assert.equal(result.body.products[0].catalog_available, true);
  assert.equal(result.body.products[0].catalog_purchasable, false);
  assert.equal(result.body.products[0].cart_verification_required, true);
  assert.equal(result.body.products[0].commerce_verification_required, true);
  assert.equal(Object.hasOwn(result.body.products[0], "available_for_sale"), false);
  assert.equal(Object.hasOwn(result.body.products[0], "verified_at"), false);
  assert.equal(JSON.stringify(result.body).includes("javascript:"), false);
  assert.equal(JSON.stringify(result.body).includes("catalog.example.invalid"), false);
  assert.equal(result.body.products[0].image, "");
  assert.equal(result.body.products[0].writes_disabled, true);
  assert.equal(result.body.checkout_created, false);
});

test("product images require an exact server-side origin allowlist", async () => {
  const allowed = await call("/api/managed-catalog/product", environment({
    MANAGED_CATALOG_IMAGE_ORIGINS: "https://images.example.invalid",
    MANAGED_CATALOG_ADAPTER: {
      getProduct: async ({ handle }) => product(handle, {
        image: "https://images.example.invalid/fixture.jpg",
      }),
    },
  }), { handle: "fixture-01", scope: "curated" });
  assert.equal(allowed.response.status, 200);
  assert.equal(allowed.body.products[0].image, "https://images.example.invalid/fixture.jpg");

  const invalidConfig = await call("/api/managed-catalog/product", environment({
    MANAGED_CATALOG_IMAGE_ORIGINS: "https://127.0.0.1",
  }), { handle: "fixture-01", scope: "curated" });
  assert.equal(invalidConfig.response.status, 503);
  assert.equal(invalidConfig.body.error, "managed_catalog_not_configured");
});

test("canonical product URL rejects active, credentialed, private, cross-store, and non-canonical URLs", () => {
  const invalid = [
    "javascript:alert(1)",
    "data:text/html,no",
    "https://user:pass@reference-store.example.invalid/products/fixture-01",
    "https://127.0.0.1/products/fixture-01",
    "https://other-store.example.invalid/products/fixture-01",
    `${STOREFRONT}/collections/all/products/fixture-01`,
    `${STOREFRONT}/products/fixture-01?variant=1`,
    `${STOREFRONT}/products/fixture-02`,
  ];
  for (const value of invalid) assert.equal(canonicalManagedProductUrl(value, "fixture-01", STOREFRONT), "");
  assert.equal(
    canonicalManagedProductUrl(`${STOREFRONT}/products/fixture-01`, "fixture-01", STOREFRONT),
    `${STOREFRONT}/products/fixture-01`,
  );
});

test("adapter failure is closed and legacy runtime routes cannot synthesize managed truth", async () => {
  const env = environment({
    MANAGED_CATALOG_ADAPTER: {
      search: async () => { throw new Error("offline fixture failure"); },
      getProduct: async ({ handle }) => product(handle),
    },
  });
  const failed = await call("/api/managed-catalog/search", env, {
    query: "desk organizer", scope: "broader_public_catalog", explicit_broader_search: true,
  });
  assert.equal(failed.response.status, 503);
  assert.equal(failed.body.error, "managed_catalog_unavailable");
  const legacy = await call("/api/runtime/status", env);
  assert.equal(legacy.response.status, 404);
  assert.equal(legacy.body.expected_mode, "managed_public_catalog");
});

test("managed adapter timeout and byte ceilings fail closed", async () => {
  const request = { query: "desk organizer", scope: "broader_public_catalog", explicit_broader_search: true };
  const timedOut = await call("/api/managed-catalog/search", environment({
    BFF_UPSTREAM_TIMEOUT_MS: "100",
    MANAGED_CATALOG_ADAPTER: {
      getProduct: async ({ handle }) => product(handle),
      search: async () => new Promise(() => {}),
    },
  }), request);
  assert.equal(timedOut.response.status, 504);
  assert.equal(timedOut.body.error, "upstream_timeout");

  const oversized = await call("/api/managed-catalog/search", environment({
    MANAGED_CATALOG_ADAPTER: {
      getProduct: async ({ handle }) => product(handle),
      search: async () => ({
        status: "results", mode: "catalog", degraded: false,
        results: [product("fixture-01", { description: "x".repeat(257 * 1024) })],
      }),
    },
  }), request);
  assert.equal(oversized.response.status, 502);
  assert.equal(oversized.body.error, "upstream_response_too_large");
});

test("actual MCP discovery accepts extra write tools while freezing the five-tool read allowlist", () => {
  const discovery = validateManagedMcpDiscovery(initializeEnvelope(), toolsEnvelope());
  assert.deepEqual(discovery.allowed_tools, MANAGED_CATALOG_READ_TOOLS);
  assert.equal(discovery.allowed_tools.includes("create_product_request"), false);
});

test("BFF emits only exact read-only MCP tool names and catalog search arguments", async () => {
  const calls = [];
  const env = environment({
    MANAGED_CATALOG_ADAPTER: {
      callTool: async (request) => {
        calls.push(request);
        return toolEnvelope({
          status: "results", mode: "catalog", degraded: false,
          results: [product("fixture-01")], next_cursor: "next-page",
        });
      },
    },
  });
  const result = await call("/api/managed-catalog/search", env, {
    query: "desk organizer",
    scope: "broader_public_catalog",
    explicit_broader_search: true,
    operation: "confirm_search",
    limit: 1,
  });
  assert.equal(result.response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "product_search");
  assert.deepEqual(calls[0].arguments, {
    query: "desk organizer", mode: "catalog", operation: "confirm_search", limit: 1,
  });
  assert.equal(calls.some((entry) => entry.name.includes("sourcing") || entry.name.startsWith("create_")), false);
});

test("non-terminal upstream no-match cannot become a BFF no-match", async () => {
  const result = await call("/api/managed-catalog/search", environment({
    MANAGED_CATALOG_ADAPTER: {
      search: async () => ({
        status: "no_match", mode: "catalog", degraded: false, results: [],
        bounded_plan_complete: false, search_scope_exhausted: false, retrieval_incomplete: true,
      }),
    },
  }), {
    query: "desk organizer", scope: "broader_public_catalog", explicit_broader_search: true,
  });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error, "invalid_upstream_contract");
});

test("missing read tool fails discovery but extra write tools do not", async () => {
  const incomplete = toolsEnvelope();
  incomplete.result.tools = incomplete.result.tools.filter((tool) => tool.name !== "get_product");
  const result = await call("/api/managed-catalog/search", environment({
    MANAGED_CATALOG_ADAPTER: { listTools: async () => incomplete },
  }), {
    query: "desk organizer", scope: "broader_public_catalog", explicit_broader_search: true,
  });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error, "invalid_upstream_contract");
});

test("managed catalog errors are public enumerations", () => {
  for (const code of [
    "broader_search_opt_in_required", "curated_not_ready", "managed_catalog_not_configured",
    "managed_catalog_unavailable", "product_not_curated", "product_not_found",
  ]) assert.ok(RUNTIME_PUBLIC_ERRORS.includes(code));
});

test("browser request fields cannot supply credentials or reconfigure the adapter", async () => {
  const result = await call("/api/managed-catalog/search", environment({
    MANAGED_CATALOG_ADAPTER_CREDENTIAL: "visibly_fake_server_only_value",
  }), {
    query: "desk organizer",
    scope: "broader_public_catalog",
    explicit_broader_search: true,
    credential: "browser-value",
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "invalid_request");
  assert.equal(JSON.stringify(result.body).includes("credential"), false);
  assert.equal(JSON.stringify(result.body).includes("visibly_fake"), false);
});

test("built-in MCP transport runs the anonymous initialize/list/call chain without retries", async (context) => {
  const calls = [];
  const responses = [
    new Response(JSON.stringify(initializeEnvelope()), {
      status: 200,
      headers: { "content-type": "application/json", "mcp-session-id": "synthetic-session-01" },
    }),
    new Response(null, { status: 202 }),
    new Response(JSON.stringify(toolsEnvelope()), {
      status: 200, headers: { "content-type": "application/json" },
    }),
    new Response(JSON.stringify(toolEnvelope({
      status: "results", mode: "catalog", degraded: false,
      results: [product("fixture-01")], next_cursor: null,
    })), { status: 200, headers: { "content-type": "application/json" } }),
  ];
  context.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return responses.shift();
  });
  const env = environment();
  delete env.MANAGED_CATALOG_ADAPTER;
  const result = await call("/api/managed-catalog/search", env, {
    query: "desk organizer", scope: "broader_public_catalog", explicit_broader_search: true,
  });
  assert.equal(result.response.status, 200);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((entry) => entry.body.method), [
    "initialize", "notifications/initialized", "tools/list", "tools/call",
  ]);
  assert.ok(calls.every((entry) => entry.url === ENDPOINT && entry.init.redirect === "error"));
  assert.ok(calls.every((entry) => !Object.hasOwn(entry.init.headers, "authorization")
    && !Object.hasOwn(entry.init.headers, "cookie")));
  assert.equal(Object.hasOwn(calls[0].init.headers, "mcp-session-id"), false);
  assert.ok(calls.slice(1).every((entry) => entry.init.headers["mcp-session-id"] === "synthetic-session-01"));
  assert.equal(calls[3].body.params.name, "product_search");
});

test("built-in transport stream-counts responses and does not retry failures", async (context) => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": String(300 * 1024) },
    });
  });
  const env = environment();
  delete env.MANAGED_CATALOG_ADAPTER;
  const result = await call("/api/managed-catalog/search", env, {
    query: "desk organizer", scope: "broader_public_catalog", explicit_broader_search: true,
  });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error, "upstream_response_too_large");
  assert.equal(calls, 1);
});

test("catalog prices reject coercion while absent and null prices remain explicitly unknown", async () => {
  for (const invalidPrice of ["19.99", false, Number.POSITIVE_INFINITY, -1]) {
    const invalid = await call("/api/managed-catalog/search", environment({
      MANAGED_CATALOG_ADAPTER: {
        search: async () => ({
          status: "results", mode: "catalog", degraded: false,
          results: [product("fixture-01", { price_usd: invalidPrice })], next_cursor: null,
        }),
      },
    }), { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true });
    assert.equal(invalid.response.status, 502, String(invalidPrice));
  }
  for (const value of [product("fixture-01", { price_usd: null }), (() => {
    const withoutPrice = product("fixture-01");
    delete withoutPrice.price_usd;
    return withoutPrice;
  })()]) {
    const unknown = await call("/api/managed-catalog/search", environment({
      MANAGED_CATALOG_ADAPTER: {
        search: async () => ({
          status: "results", mode: "catalog", degraded: false, results: [value], next_cursor: null,
        }),
      },
    }), { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true });
    assert.equal(unknown.response.status, 200);
    assert.equal(unknown.body.products[0].catalog_price, null);
  }
});

test("detail and curated reads bind every response to the requested unique handle", async () => {
  const detail = await call("/api/managed-catalog/product", environment({
    MANAGED_CATALOG_ADAPTER: { getProduct: async () => product("fixture-02") },
  }), { handle: "fixture-01", scope: "broader_public_catalog", explicit_broader_search: true });
  assert.equal(detail.response.status, 502);
  assert.equal(detail.body.error, "invalid_upstream_contract");

  const curated = await call("/api/managed-catalog/curated", environment({
    MANAGED_CATALOG_ADAPTER: { getProduct: async () => product("fixture-01") },
  }));
  assert.equal(curated.response.status, 503);
  assert.equal(curated.body.error, "curated_not_ready");
});

test("terminal and degraded search states reject contradictory result facts", async () => {
  const cases = [
    {
      status: "no_match", mode: "catalog", degraded: false, results: [product("fixture-01")],
      bounded_plan_complete: true, search_scope_exhausted: true, retrieval_incomplete: false,
    },
    { status: "results", mode: "catalog", degraded: true, results: [product("fixture-01")] },
    {
      status: "no_match", mode: "catalog", degraded: false, results: [], next_cursor: "next-page",
      bounded_plan_complete: true, search_scope_exhausted: true, retrieval_incomplete: false,
    },
    {
      status: "no_match", mode: "catalog", degraded: false, results: [],
      bounded_plan_complete: true, search_scope_exhausted: true, retrieval_incomplete: false,
      scan_limit_reached: false,
      search_scope: { plan_complete: false, scope_exhausted: true, scan_limit_reached: false, degraded: false },
    },
  ];
  for (const upstream of cases) {
    const result = await call("/api/managed-catalog/search", environment({
      MANAGED_CATALOG_ADAPTER: { search: async () => upstream },
    }), { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true });
    assert.equal(result.response.status, 502);
    assert.equal(result.body.error, "invalid_upstream_contract");
  }
  const valid = await call("/api/managed-catalog/search", environment({
    MANAGED_CATALOG_ADAPTER: { search: async () => ({
      status: "no_match", mode: "catalog", degraded: false, results: [], next_cursor: null,
      has_more: false, bounded_plan_complete: true, search_scope_exhausted: true,
      retrieval_incomplete: false, scan_limit_reached: false,
    }) },
  }), { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true });
  assert.equal(valid.response.status, 200);
  assert.equal(valid.body.status, "no_match");
  assert.equal(valid.body.products.length, 0);
});

test("an incomplete curated page cannot be relabelled as terminal no-match", async () => {
  const result = await call("/api/managed-catalog/search", environment({
    MANAGED_CATALOG_ADAPTER: { search: async () => ({
      status: "results", mode: "catalog", degraded: false,
      results: [product("outside-cohort")], next_cursor: "next-page", has_more: true,
    }) },
  }), { query: "fixture", scope: "curated", explicit_broader_search: false });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.error, "invalid_upstream_contract");
});

test("upstream product scalar fields reject arrays, booleans, and objects without coercion", async () => {
  const malformedProducts = [
    product("fixture-01", { handle: ["fixture-01"] }),
    product("fixture-01", { title: true }),
    product("fixture-01", { currency: ["USD"] }),
    product("fixture-01", { purchase_status: ["cart_verification_required"] }),
    product("fixture-01", { description: null, summary: { text: "not scalar" } }),
    product("fixture-01", { image: false }),
  ];
  for (const malformed of malformedProducts) {
    const result = await call("/api/managed-catalog/search", environment({
      MANAGED_CATALOG_ADAPTER: { search: async () => ({
        status: "results", mode: "catalog", degraded: false, results: [malformed], next_cursor: null,
      }) },
    }), { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true });
    assert.equal(result.response.status, 502);
    assert.equal(result.body.error, "invalid_upstream_contract");
  }
  const malformedCursor = await call("/api/managed-catalog/search", environment({
    MANAGED_CATALOG_ADAPTER: { search: async () => ({
      status: "results", mode: "catalog", degraded: false,
      results: [product("fixture-01")], next_cursor: ["next"],
    }) },
  }), { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true });
  assert.equal(malformedCursor.response.status, 502);
  assert.equal(malformedCursor.body.error, "invalid_upstream_contract");
});

test("browser query, handle, cursor, operation, scope, and limit require their exact scalar types", async () => {
  const searchBodies = [
    { query: ["fixture"], scope: "broader_public_catalog", explicit_broader_search: true },
    { query: "fixture", scope: ["broader_public_catalog"], explicit_broader_search: true },
    { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true, limit: "1" },
    { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true, cursor: ["next"], operation: "more" },
    { query: "fixture", scope: "broader_public_catalog", explicit_broader_search: true, operation: ["search"] },
  ];
  for (const body of searchBodies) {
    const result = await call("/api/managed-catalog/search", environment(), body);
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, "invalid_request");
  }
  const detail = await call("/api/managed-catalog/product", environment(), {
    handle: ["fixture-01"], scope: "broader_public_catalog", explicit_broader_search: true,
  });
  assert.equal(detail.response.status, 400);
  assert.equal(detail.body.error, "invalid_request");
});

test("initialized notification rejects and cancels every unexpected response body", async () => {
  let fetchCalls = 0;
  let cancelled = false;
  const unexpectedBody = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(300 * 1024)); },
    cancel() { cancelled = true; },
  });
  const adapter = createAnonymousManagedMcpAdapter(async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return new Response(JSON.stringify(initializeEnvelope()), {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "synthetic-session-02" },
      });
    }
    return new Response(unexpectedBody, { status: 202 });
  });
  await assert.rejects(adapter.initialize({
    endpoint: ENDPOINT,
    signal: new AbortController().signal,
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "fixture", version: "1" },
  }), (error) => error.code === "invalid_upstream_contract" && error.status === 502);
  assert.equal(fetchCalls, 2);
  assert.equal(cancelled, true);
});
