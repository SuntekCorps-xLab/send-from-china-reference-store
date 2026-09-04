import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { startDemo } from "../server.mjs";

const TOKEN = "fake_local_sandbox_bearer_not_for_browser";
const STORE = "https://sandbox-store.example.invalid";
const CHECKED_AT = "2026-08-31T00:00:00.000Z";
const VERIFIED_AT = "2026-08-31T00:00:01.000Z";

function capabilities(reads) {
  return {
    doctor: true,
    catalog_search: reads,
    search_contract_v2: reads,
    product_detail: reads,
    storefront_health: reads,
    cart: false,
    checkout: false,
    order: false,
    payment: false,
    inventory: false,
    publication: false,
    product_mutation: false,
  };
}

function liveStatus(state = "succeeded") {
  const verified = state === "succeeded";
  const errors = {
    credential_missing: "CREDENTIAL_MISSING",
    authentication_failed: "AUTHENTICATION_FAILED",
    permission_required: "PERMISSION_REQUIRED",
    quota_exceeded: "QUOTA_EXCEEDED",
    service_unavailable: "SERVICE_UNAVAILABLE",
  };
  return {
    contract: "shopify-live-sandbox-status/v1",
    mode: "shopify_read_only",
    verified,
    credential_state: state,
    data_source: "shopify_storefront_graphql",
    api_version: "2026-07",
    quota: {
      limit: 100,
      remaining: verified ? 97 : 0,
      window_seconds: 60,
      concurrency_limit: 4,
      reset_at: CHECKED_AT,
    },
    writes: false,
    non_transactional: true,
    capabilities: capabilities(verified),
    checked_at: CHECKED_AT,
    error_code: verified ? null : errors[state],
    purchasable: false,
    shipping_rates: false,
    commerce_writes: false,
    credential_exposed: false,
  };
}

function liveSearch(productUrl = `${STORE}/products/verified-desk-organizer`) {
  return {
    contract_version: "2.0",
    trace_id: "shopify-demo-integration-trace",
    status: "results",
    normalized_intent: {
      product_identity: {
        name: "product_identity",
        value: "desk organizer",
        source: "explicit",
        scope: "product",
        hardness: "hard",
      },
      hard_constraints: [],
      soft_context: [],
      transaction_context: [],
    },
    relaxations: [],
    missing_criteria: [],
    results: [{
      public_id: "0123456789abcdefABCDEF",
      slug: "verified-desk-organizer",
      handle: "verified-desk-organizer",
      title: "Verified desk organizer",
      description: "Published Shopify product data.",
      images: [],
      price: { amount: 19.95, currency: "USD" },
      availability_band: "in_stock",
      as_of: VERIFIED_AT,
      purchasable: false,
      product_url: productUrl,
      availableForSale: true,
      shopify_verified_at: VERIFIED_AT,
      non_transactional: true,
      transaction_boundary: "catalog_read_only_non_transactional",
      writes: false,
      mode: "shopify_read_only",
      data_source: "shopify_storefront_graphql",
      illustrative_only: false,
      available: false,
    }],
    pagination: { limit: 20, cursor: null, next_cursor: null, has_more: false },
    search_scope: {
      plan_complete: true,
      scope_exhausted: true,
      global_catalog_exhaustive: false,
      scan_limit_reached: false,
      degraded: false,
      degraded_reason: null,
    },
    compatibility: { adapter: "product_search_v1", legacy_status: "catalog_match" },
    mode: "shopify_read_only",
    data_source: "shopify_storefront_graphql",
    illustrative_only: false,
    purchasable: false,
    available: false,
    writes: false,
    non_transactional: true,
    transaction_boundary: "catalog_read_only_non_transactional",
    shopify_verified_at: VERIFIED_AT,
  };
}

async function startFakeS1({ state = "succeeded", productUrl } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      path: new URL(request.url || "/", "http://127.0.0.1").pathname,
      authorization: String(request.headers.authorization || ""),
      body,
    });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/sandbox/status") {
      response.end(JSON.stringify(liveStatus(state)));
      return;
    }
    if (request.method === "POST" && request.url === "/sandbox/api/search/v2") {
      response.end(JSON.stringify(liveSearch(productUrl)));
      return;
    }
    response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withShopifyDemo(fake, run) {
  const demo = await startDemo({
    mode: "shopify",
    port: 0,
    agentCoreSandboxUrl: fake.baseUrl,
    agentCoreSandboxToken: TOKEN,
    storefrontOrigin: STORE,
  });
  try { await run(demo.baseUrl); }
  finally { await demo.close(); }
}

test("offline synthetic runtime exposes closed status, doctor, and read-run responses", async (context) => {
  const clientFetch = globalThis.fetch.bind(globalThis);
  const outbound = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("synthetic runtime must stay offline");
  });
  const demo = await startDemo({ port: 0 });
  try {
    const statusResponse = await clientFetch(`${demo.baseUrl}/api/runtime/status`);
    const status = await statusResponse.json();
    assert.equal(status.mode, "synthetic_local_sandbox");
    assert.equal(status.connected, true);
    assert.equal(statusResponse.headers.get("cache-control"), "no-store");
    assert.equal(statusResponse.headers.get("set-cookie"), null);
    const doctor = await (await clientFetch(`${demo.baseUrl}/api/runtime/doctor`)).json();
    assert.equal(doctor.ok, true);
    assert.deepEqual(doctor.runtime, status);
    const run = await (await clientFetch(`${demo.baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "desk organizer" }),
    })).json();
    assert.deepEqual(run.runtime, status);
    assert.equal(run.search.results[0].synthetic, true);
    assert.equal(run.search.results[0].product_url, "");
    const querySwitch = await clientFetch(`${demo.baseUrl}/api/runtime/status?mode=shopify_read_only`);
    assert.equal(querySwitch.status, 400);
    assert.equal((await querySwitch.json()).error, "invalid_request");
  } finally {
    await demo.close();
  }
  assert.equal(outbound.mock.callCount(), 0);
});

test("mock Shopify mode returns only the BFF-verified read-only facts and hides credentials", async () => {
  const fake = await startFakeS1();
  try {
    await withShopifyDemo(fake, async (baseUrl) => {
      const statusText = await (await fetch(`${baseUrl}/api/runtime/status`)).text();
      assert.equal(statusText.includes(TOKEN), false);
      assert.equal(JSON.parse(statusText).mode, "shopify_read_only");
      const legacyStatus = await (await fetch(`${baseUrl}/api/status`)).json();
      assert.equal(legacyStatus.mode, "shopify_read_only");
      for (const route of ["/api/chat", "/api/search"]) {
        const disabled = await fetch(`${baseUrl}${route}`, { method: "POST", body: "{}" });
        assert.equal(disabled.status, 404);
        assert.deepEqual(await disabled.json(), { error: "not_found" });
      }
      const response = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ query: "desk organizer" }),
      });
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(text.includes(TOKEN), false);
      const run = JSON.parse(text);
      assert.deepEqual(run.search.results[0], {
        public_id: "0123456789abcdefABCDEF",
        handle: "verified-desk-organizer",
        title: "Verified desk organizer",
        summary: "Published Shopify product data.",
        image: "",
        price: { amount: 19.95, currency: "USD" },
        available_for_sale: true,
        product_url: `${STORE}/products/verified-desk-organizer`,
        shopify_verified_at: VERIFIED_AT,
        synthetic: false,
        non_transactional: true,
        purchasable: false,
        writes: false,
        shipping_rates: false,
      });
      const page = await (await fetch(`${baseUrl}/`)).text();
      assert.equal(page.includes(TOKEN), false);
    });
    assert.ok(fake.requests.length >= 3);
    assert.ok(fake.requests.every((entry) => entry.authorization === `Bearer ${TOKEN}`));
  } finally {
    await fake.close();
  }
});

test("Shopify failure states remain Shopify and never silently fall back", async () => {
  for (const [state, expectedStatus] of [
    ["credential_missing", 503],
    ["authentication_failed", 502],
    ["permission_required", 502],
    ["quota_exceeded", 429],
    ["service_unavailable", 503],
  ]) {
    const fake = await startFakeS1({ state });
    try {
      await withShopifyDemo(fake, async (baseUrl) => {
        const status = await (await fetch(`${baseUrl}/api/runtime/status`)).json();
        assert.equal(status.mode, "shopify_read_only");
        assert.equal(status.connected, false);
        assert.equal(status.credential_state, state);
        const response = await fetch(`${baseUrl}/api/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "desk organizer" }),
        });
        assert.equal(response.status, expectedStatus);
        const body = await response.json();
        assert.equal(body.error, state);
        assert.equal(body.runtime.mode, "shopify_read_only");
        assert.equal(body.runtime.connected, false);
      });
    } finally {
      await fake.close();
    }
  }
});

test("Shopify demo rejects unsafe bind/config and bounded input without upstream search", async () => {
  await assert.rejects(startDemo({
    mode: "shopify",
    host: "localhost",
    agentCoreSandboxUrl: "http://127.0.0.1:8787",
    storefrontOrigin: STORE,
  }), /shopify_demo_requires_127_0_0_1/u);
  const fake = await startFakeS1();
  try {
    await withShopifyDemo(fake, async (baseUrl) => {
      const before = fake.requests.length;
      const response = await fetch(`${baseUrl}/api/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "x".repeat(40_000) }),
      });
      assert.equal(response.status, 413);
      assert.equal((await response.json()).error, "request_too_large");
      assert.equal(fake.requests.length, before);
    });
  } finally {
    await fake.close();
  }
});
