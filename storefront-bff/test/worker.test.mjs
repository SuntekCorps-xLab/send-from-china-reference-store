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

test("adapts browser POST search to Agent Core GET search", async (context) => {
  let upstreamRequest;
  context.mock.method(globalThis, "fetch", async (request, init) => {
    upstreamRequest = new Request(request, init);
    return Response.json({ items: [{
      public_id: "pub_demo_02",
      slug: "reading-light",
      title: "Reading Light",
      images: [],
      availability_band: "low",
      purchasable: true,
      product_url: "https://store.example.test/products/reading-light",
    }] });
  });
  const response = await call("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "small reading light", topK: 99 }),
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamRequest.method, "GET");
  const url = new URL(upstreamRequest.url);
  assert.equal(url.pathname, "/api/search");
  assert.equal(url.searchParams.get("q"), "small reading light");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal((await response.json()).results[0].available, true);
});

test("keeps derived slug links browseable without claiming purchase readiness", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ items: [{
    public_id: "pub_reference_only",
    slug: "reference-only",
    title: "Reference only",
    availability_band: "available",
    purchasable: true,
  }] }));
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
  context.mock.method(globalThis, "fetch", async () => Response.json({ items: [{
    public_id: "pub_off_origin",
    slug: "safe-fallback",
    title: "Off-origin source",
    availability_band: "available",
    purchasable: true,
    product_url: "https://supplier.example/products/private-source",
    add_to_cart_url: "https://other-shop.example/cart/add?id=1",
    image: "https://user:pass@images.example.test/private.jpg",
  }] }));
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
  context.mock.method(globalThis, "fetch", async () => Response.json({ items: [{
    public_id: "pub_invalid_store",
    slug: "must-not-be-linked",
    title: "Invalid storefront configuration",
    availability: "available",
    purchasable: true,
    product_url: "https://store.example.test/products/must-not-be-linked",
  }] }));
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
