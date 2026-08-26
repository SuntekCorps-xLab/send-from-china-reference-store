import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

const env = {
  AGENT_CORE_BASE_URL: "https://core.example.test",
  AGENT_CORE_TENANT_KEY: "test_tenant_key_not_a_secret",
  STOREFRONT_ORIGIN: "https://store.example.test",
  ALLOWED_ORIGINS: "https://store.example.test",
};

function call(path, init = {}, bindings = env) {
  return worker.fetch(new Request(`https://bff.example.test${path}`, init), bindings);
}

function condition(name, value, source = "explicit", scope = "product", hardness = "hard") {
  return { name, value, source, scope, hardness };
}

function searchContractResponse({
  status = "results",
  results = [],
  limit = 20,
  nextCursor = null,
  hasMore = false,
  degraded = false,
  missingCriteria = [],
  normalizedIntent = null,
} = {}) {
  return {
    contract_version: "2.0",
    trace_id: "trace_reference_store_test",
    status,
    normalized_intent: normalizedIntent || {
      product_identity: condition("product_identity", "reference product"),
      hard_constraints: [],
      soft_context: [],
      transaction_context: [],
    },
    relaxations: [],
    missing_criteria: missingCriteria,
    results,
    pagination: { limit, cursor: null, next_cursor: nextCursor, has_more: hasMore },
    search_scope: {
      plan_complete: status === "no_match",
      scope_exhausted: status === "no_match",
      global_catalog_exhaustive: false,
      scan_limit_reached: false,
      degraded,
      degraded_reason: degraded ? "The complete index is temporarily unavailable." : null,
    },
  };
}

test("health is public and contains no configuration", async () => {
  const response = await call("/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "send-from-china-storefront-bff" });
});

test("rejects an unapproved browser origin", async () => {
  const response = await call("/api/chat", {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "desk lamp" }] }),
  });
  assert.equal(response.status, 403);
});

test("fails closed when Agent Core is not configured", async () => {
  const response = await call("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "desk lamp" }] }),
  }, { ...env, AGENT_CORE_TENANT_KEY: "" });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "service_not_configured" });
});

test("keeps the tenant key server-side and maps products for the drawer", async (context) => {
  let upstreamRequest;
  context.mock.method(globalThis, "fetch", async (request, init) => {
    upstreamRequest = new Request(request, init);
    return Response.json({
      reply: "Two governed matches are available.",
      criteria: { price_max: 40 },
      criteria_evaluation: { enforced: ["price_max"], informational: [] },
      products: [{
        public_id: "pub_demo_01",
        slug: "walnut-desk-tray",
        title: "Walnut Desk Tray",
        description: "A compact wood organizer.",
        category: "Desk storage",
        images: [{ url: "https://images.example.test/tray.jpg" }],
        price: { amount: 29, currency: "USD" },
        availability_band: "available",
        purchasable: true,
        product_url: "https://store.example.test/products/walnut-desk-tray",
        add_to_cart_url: "https://store.example.test/cart/add?id=123",
      }],
      next_actions: ["Compare materials"],
    });
  });
  const response = await call("/api/chat", {
    method: "POST",
    headers: { origin: "https://store.example.test", "content-type": "application/json" },
    body: JSON.stringify({
      session_id: "chat_12345678",
      messages: [{ role: "user", content: "desk tray" }],
      criteria: { price_max: 40 },
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.headers.get("authorization"), `Bearer ${env.AGENT_CORE_TENANT_KEY}`);
  assert.equal(upstreamRequest.method, "POST");
  assert.equal(upstreamRequest.url, "https://core.example.test/api/chat");
  assert.deepEqual(await upstreamRequest.json(), {
    messages: [{ role: "user", content: "desk tray" }],
    criteria: { price_max: 40 },
  });
  const payload = await response.json();
  assert.equal(payload.results[0].url, "https://store.example.test/products/walnut-desk-tray");
  assert.equal(payload.results[0].browse_url, "https://store.example.test/products/walnut-desk-tray");
  assert.equal(payload.results[0].product_url, "https://store.example.test/products/walnut-desk-tray");
  assert.equal(payload.results[0].available, true);
  assert.equal(payload.results[0].purchase_handoff, "merchant_product");
  assert.equal(payload.results[0].add_to_cart_url, "https://store.example.test/cart/add?id=123");
  assert.deepEqual(payload.requested_criteria, { price_max: 40 });
  assert.deepEqual(payload.criteria, { price_max: 40 });
  assert.deepEqual(payload.criteria_evaluation.enforced, ["price_max"]);
  assert.equal(payload.next_actions[0].operation, "chat");
  assert.equal(payload.live_agent_core, true);
  assert.equal(JSON.stringify(payload).includes(env.AGENT_CORE_TENANT_KEY), false);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://store.example.test");
});

test("adapts a browser query to Agent Core Search Contract v2 without adding search rules", async (context) => {
  let upstreamRequest;
  context.mock.method(globalThis, "fetch", async (request, init) => {
    upstreamRequest = new Request(request, init);
    return Response.json(searchContractResponse({ results: [{
      public_id: "pub_demo_02",
      slug: "reading-light",
      title: "Reading Light",
      images: [],
      availability_band: "low",
      purchasable: true,
      product_url: "https://store.example.test/products/reading-light",
    }] }));
  });
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "small reading light", topK: 99 }),
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.method, "POST");
  const url = new URL(upstreamRequest.url);
  assert.equal(url.pathname, "/api/search/v2");
  const upstreamBody = await upstreamRequest.json();
  assert.deepEqual(upstreamBody, {
    contract_version: "2.0",
    product_identity: condition("product_identity", "small reading light"),
    hard_constraints: [],
    soft_context: [],
    transaction_context: [],
    limit: 20,
    cursor: null,
  });
  const payload = await response.json();
  assert.equal(payload.contract_version, "2.0");
  assert.equal(payload.status, "results");
  assert.equal(payload.results[0].available, true);
  assert.equal(payload.trace_id, "trace_reference_store_test");
});

test("forwards a complete v2 request and exposes truthful pagination metadata", async (context) => {
  let upstreamRequest;
  context.mock.method(globalThis, "fetch", async (request, init) => {
    upstreamRequest = new Request(request, init);
    return Response.json(searchContractResponse({
      results: [{ title: "Desk tray", slug: "desk-tray" }],
      nextCursor: "cursor_page_2",
      hasMore: true,
    }));
  });
  const searchContract = {
    contract_version: "2.0",
    product_identity: condition("product_identity", "desk tray"),
    hard_constraints: [
      condition("material", "wood"),
      condition("must_have", ["foldable", "compact"]),
    ],
    soft_context: [condition("recipient", "coworker", "explicit", "session", "soft")],
    transaction_context: [condition("ship_to", "US", "explicit", "transaction", "informational")],
    limit: 20,
    cursor: "cursor_page_1",
  };
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ search_contract: searchContract }),
  }, { ...env, AGENT_CORE_PAGE_SIZE: "20" });
  assert.equal(response.status, 200);
  assert.deepEqual(await upstreamRequest.json(), searchContract);
  const payload = await response.json();
  assert.equal(payload.pagination.next_cursor, "cursor_page_2");
  assert.equal(payload.pagination.has_more, true);
  assert.equal(payload.normalized_intent.product_identity.value, "reference product");
  assert.equal(JSON.stringify(payload).includes(env.AGENT_CORE_TENANT_KEY), false);
});

test("accepts normalized intent groups that follow Search Contract v2 semantics", async (context) => {
  const normalizedIntent = {
    product_identity: condition("product_identity", "desk organizer", "inferred", "product", "hard"),
    hard_constraints: [condition("material", "wood", "explicit", "product", "hard")],
    soft_context: [
      condition("recipient", "coworker", "inferred", "session", "soft"),
      condition("room", "home office", "default", "product", "informational"),
    ],
    transaction_context: [
      condition("ship_to", "US", "explicit", "transaction", "hard"),
      condition("quantity", 1, "inferred", "transaction", "informational"),
    ],
  };
  context.mock.method(globalThis, "fetch", async () => Response.json(searchContractResponse({
    normalizedIntent,
    results: [{ title: "Wood desk organizer", slug: "wood-desk-organizer" }],
  })));
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "desk organizer" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).normalized_intent, normalizedIntent);
});

test("rejects normalized intent conditions placed in the wrong semantic group", async (context) => {
  const validIdentity = condition("product_identity", "desk organizer");
  const invalidIntents = [
    {
      product_identity: condition("category", "desk organizer"),
      hard_constraints: [], soft_context: [], transaction_context: [],
    },
    {
      product_identity: condition("product_identity", "desk organizer", "explicit", "session", "hard"),
      hard_constraints: [], soft_context: [], transaction_context: [],
    },
    {
      product_identity: condition("product_identity", "desk organizer", "explicit", "product", "soft"),
      hard_constraints: [], soft_context: [], transaction_context: [],
    },
    {
      product_identity: { ...validIdentity, value: ["desk organizer"] },
      hard_constraints: [], soft_context: [], transaction_context: [],
    },
    {
      product_identity: validIdentity,
      hard_constraints: [condition("material", "wood", "inferred", "product", "hard")],
      soft_context: [], transaction_context: [],
    },
    {
      product_identity: validIdentity,
      hard_constraints: [],
      soft_context: [condition("recipient", "friend", "explicit", "transaction", "soft")],
      transaction_context: [],
    },
    {
      product_identity: validIdentity,
      hard_constraints: [],
      soft_context: [condition("recipient", "friend", "explicit", "session", "hard")],
      transaction_context: [],
    },
    {
      product_identity: validIdentity,
      hard_constraints: [], soft_context: [],
      transaction_context: [condition("ship_to", "US", "explicit", "product", "informational")],
    },
    {
      product_identity: validIdentity,
      hard_constraints: [], soft_context: [],
      transaction_context: [condition("ship_to", "US", "inferred", "transaction", "hard")],
    },
  ];
  context.mock.method(globalThis, "fetch", async () => Response.json(searchContractResponse({
    normalizedIntent: invalidIntents.shift(),
    results: [{ title: "Desk organizer", slug: "desk-organizer" }],
  })));
  while (invalidIntents.length) {
    const response = await call("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "desk organizer" }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "invalid_upstream_contract" });
  }
});

test("accepts an Agent Core tenant page limit lower than the BFF request", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json(searchContractResponse({
    limit: 5,
    results: [{ title: "Tenant-capped result", slug: "tenant-capped-result" }],
  })));
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "desk tray", limit: 20 }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.pagination.limit, 5);
  assert.equal(payload.results.length, 1);
});

test("preserves no_match, needs_clarification, and degraded as distinct contract states", async (context) => {
  const responses = [
    searchContractResponse({ status: "no_match" }),
    searchContractResponse({ status: "needs_clarification", missingCriteria: ["product_identity"] }),
    searchContractResponse({ status: "degraded", degraded: true }),
  ];
  context.mock.method(globalThis, "fetch", async () => Response.json(responses.shift()));
  for (const expected of ["no_match", "needs_clarification", "degraded"]) {
    const response = await call("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "query" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, expected);
  }
});

test("keeps derived slug links browseable without claiming purchase readiness", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json(searchContractResponse({ results: [{
    public_id: "pub_reference_only",
    slug: "reference-only",
    title: "Reference only",
    availability_band: "available",
    purchasable: true,
  }] })));
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "reference" }),
  });
  const product = (await response.json()).results[0];
  assert.equal(product.url, "https://store.example.test/products/reference-only");
  assert.equal(product.browse_url, "https://store.example.test/products/reference-only");
  assert.equal(product.product_url, "");
  assert.equal(product.available, false);
  assert.equal(product.purchase_handoff, null);
  assert.equal(product.add_to_cart_url, "");
});

test("rejects supplier and cross-store URLs from the commerce handoff", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json(searchContractResponse({ results: [{
    public_id: "pub_off_origin",
    slug: "safe-fallback",
    title: "Off-origin source",
    availability_band: "available",
    purchasable: true,
    product_url: "https://supplier.example/products/private-source",
    add_to_cart_url: "https://other-shop.example/cart/add?id=1",
    image: "https://user:pass@images.example.test/private.jpg",
  }] })));
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "source" }),
  });
  const product = (await response.json()).results[0];
  assert.equal(product.url, "https://store.example.test/products/safe-fallback");
  assert.equal(product.product_url, "");
  assert.equal(product.available, false);
  assert.equal(product.add_to_cart_url, "");
  assert.equal(product.image, "");
  assert.equal(JSON.stringify(product).includes("supplier.example"), false);
  assert.equal(JSON.stringify(product).includes("other-shop.example"), false);
});

test("fails closed when the storefront origin is not an exact HTTPS origin", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json(searchContractResponse({ results: [{
    public_id: "pub_invalid_store",
    slug: "must-not-be-linked",
    title: "Invalid storefront configuration",
    availability: "available",
    purchasable: true,
    product_url: "https://store.example.test/products/must-not-be-linked",
  }] })));
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "invalid store" }),
  }, { ...env, STOREFRONT_ORIGIN: "https://store.example.test/path?tenant=one" });
  const product = (await response.json()).results[0];
  assert.equal(product.url, "");
  assert.equal(product.browse_url, "");
  assert.equal(product.product_url, "");
  assert.equal(product.available, false);
  assert.equal(product.purchase_handoff, null);
});

test("fails closed when the Agent Core base URL carries credentials or request state", async () => {
  const init = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "desk" }),
  };
  for (const base of [
    "https://user:pass@core.example.test",
    "https://core.example.test?tenant=one",
    "https://core.example.test#catalog",
  ]) {
    const response = await call("/api/search", init, { ...env, AGENT_CORE_BASE_URL: base });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "service_not_configured" });
  }
});

test("fails closed on an invalid or unsupported upstream search contract", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ items: [] }));
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "desk" }),
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "invalid_upstream_contract" });
});

test("rejects incomplete terminal scope and result pages larger than the requested limit", async (context) => {
  const unsafeMiss = searchContractResponse({ status: "no_match" });
  unsafeMiss.search_scope.scan_limit_reached = true;
  const oversizedPage = searchContractResponse({
    limit: 1,
    results: [{ title: "One" }, { title: "Two" }],
  });
  const responses = [unsafeMiss, oversizedPage];
  context.mock.method(globalThis, "fetch", async () => Response.json(responses.shift()));

  for (const input of [{ q: "miss" }, { q: "page", limit: 1 }]) {
    const response = await call("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "invalid_upstream_contract" });
  }
});

test("keeps Search Contract error mapping scoped to the search route", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ private_detail: "not returned" }, { status: 404 }));
  const response = await call("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "desk" }] }),
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "upstream_unavailable" });
});

test("rejects malformed full contracts before calling Agent Core", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call upstream");
  });
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      search_contract: {
        contract_version: "2.0",
        product_identity: condition("recipient", "friend", "explicit", "session", "soft"),
        hard_constraints: [],
        soft_context: [],
        transaction_context: [],
        limit: 20,
        cursor: null,
      },
    }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_search_request" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects full requests that put conditions in an incompatible contract group", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call upstream");
  });
  const invalidGroups = [
    {
      hard_constraints: [condition("material", "wood", "inferred", "product", "hard")],
      soft_context: [], transaction_context: [],
    },
    {
      hard_constraints: [],
      soft_context: [condition("recipient", "friend", "explicit", "transaction", "soft")],
      transaction_context: [],
    },
    {
      hard_constraints: [], soft_context: [],
      transaction_context: [condition("ship_to", "US", "inferred", "transaction", "hard")],
    },
  ];
  for (const groups of invalidGroups) {
    const response = await call("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        search_contract: {
          contract_version: "2.0",
          product_identity: condition("product_identity", "desk organizer"),
          ...groups,
          limit: 20,
          cursor: null,
        },
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_search_request" });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects non-canonical or incorrectly typed full v2 request conditions", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call upstream");
  });
  const identity = condition("product_identity", "desk organizer");
  const valid = {
    contract_version: "2.0",
    product_identity: identity,
    hard_constraints: [],
    soft_context: [],
    transaction_context: [],
    limit: 20,
    cursor: null,
  };
  const hard = (name, value) => condition(name, value, "explicit", "product", "hard");
  const transaction = (name, value) => condition(name, value, "explicit", "transaction", "hard");
  const invalidContracts = [
    { ...valid, unsupported: true },
    { ...valid, limit: "20" },
    { ...valid, cursor: 2 },
    { ...valid, product_identity: { ...identity, name: true } },
    { ...valid, product_identity: { ...identity, private_hint: "supplier" } },
    { ...valid, hard_constraints: [hard("size", "large")] },
    { ...valid, hard_constraints: [hard("price_max", "30")] },
    { ...valid, hard_constraints: [hard("price_min", -1)] },
    { ...valid, hard_constraints: [hard("material", 304)] },
    { ...valid, hard_constraints: [hard("must_have", ["foldable", 1])] },
    { ...valid, hard_constraints: [hard("exclude", Array.from({ length: 21 }, (_, index) => `item-${index}`))] },
    { ...valid, transaction_context: [transaction("postal_code", "22202")] },
    { ...valid, transaction_context: [transaction("ship_to", 1)] },
    { ...valid, transaction_context: [transaction("quantity", "2")] },
    { ...valid, transaction_context: [transaction("quantity", 0)] },
    { ...valid, transaction_context: [transaction("quantity", 1.5)] },
    { ...valid, transaction_context: [transaction("delivery_days_max", "3")] },
  ];
  for (const searchContract of invalidContracts) {
    const response = await call("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ search_contract: searchContract }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_search_request" });
  }
  assert.equal(fetchMock.mock.callCount(), 0);

  for (const body of [
    { search_contract: null, q: "desk organizer" },
    { contract_version: "", q: "desk organizer" },
  ]) {
    const response = await call("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_search_request" });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects non-canonical or incorrectly typed v2 conditions from Agent Core", async (context) => {
  const identity = condition("product_identity", "desk organizer");
  const baseIntent = {
    product_identity: identity,
    hard_constraints: [],
    soft_context: [],
    transaction_context: [],
  };
  const hard = (name, value) => condition(name, value, "explicit", "product", "hard");
  const transaction = (name, value) => condition(name, value, "explicit", "transaction", "hard");
  const invalidIntents = [
    { ...baseIntent, product_identity: { ...identity, private_hint: "supplier" } },
    { ...baseIntent, hard_constraints: [hard("size", "large")] },
    { ...baseIntent, hard_constraints: [hard("price_max", "30")] },
    { ...baseIntent, hard_constraints: [hard("material", 304)] },
    { ...baseIntent, hard_constraints: [hard("must_have", ["foldable", false])] },
    { ...baseIntent, transaction_context: [transaction("postal_code", "22202")] },
    { ...baseIntent, transaction_context: [transaction("ship_to", 1)] },
    { ...baseIntent, transaction_context: [transaction("quantity", "2")] },
    { ...baseIntent, transaction_context: [transaction("delivery_days_max", 1.5)] },
  ];
  context.mock.method(globalThis, "fetch", async () => Response.json(searchContractResponse({
    normalizedIntent: invalidIntents.shift(),
    results: [{ title: "Desk organizer", slug: "desk-organizer" }],
  })));
  const expectedCalls = invalidIntents.length;
  for (let index = 0; index < expectedCalls; index += 1) {
    const response = await call("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "desk organizer" }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "invalid_upstream_contract" });
  }
});

test("maps upstream search authentication, version, validation, and rate errors without leaking bodies", async (context) => {
  const responses = [
    Response.json({ private_detail: "not returned" }, { status: 401 }),
    Response.json({ private_detail: "not returned" }, { status: 404 }),
    Response.json({ private_detail: "not returned" }, { status: 400 }),
    Response.json({ private_detail: "not returned" }, { status: 429, headers: { "retry-after": "17" } }),
  ];
  context.mock.method(globalThis, "fetch", async () => responses.shift());
  const expected = [
    [502, { error: "upstream_authentication_failed" }],
    [502, { error: "search_contract_not_supported" }],
    [400, { error: "invalid_search_request" }],
    [429, { error: "rate_limited" }],
  ];
  for (const [status, body] of expected) {
    const response = await call("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "desk" }),
    });
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    if (status === 429) assert.equal(response.headers.get("retry-after"), "17");
  }
});

test("rejects invalid and oversized chat requests without calling upstream", async () => {
  const invalid = await call("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not-json",
  });
  assert.equal(invalid.status, 400);

  const oversized = await call("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "40000" },
    body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
  });
  assert.equal(oversized.status, 413);

  const empty = await call("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "  " }] }),
  });
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: "invalid_request" });
});
