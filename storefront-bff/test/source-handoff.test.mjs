import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import worker from "../src/index.js";

const STOREFRONT = "https://reference-store.example.invalid";
const TOKEN = "synthetic_source_token_1234567890";

function environment(overrides = {}) {
  return {
    BFF_RUNTIME_MODE: "managed_public_catalog",
    BFF_DEPLOYMENT_MODE: "local",
    STOREFRONT_ORIGIN: STOREFRONT,
    ALLOWED_ORIGINS: STOREFRONT,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    product_handle: "fixture-01",
    product_url: `${STOREFRONT}/products/fixture-01`,
    source: "curated_catalog",
    consent: "granted",
    source_token: TOKEN,
    ...overrides,
  };
}

async function call(env, body = input(), requestOverrides = {}) {
  const request = new Request("http://127.0.0.1/api/source-handoff", {
    method: "POST",
    headers: { origin: STOREFRONT, "content-type": "application/json", ...(requestOverrides.headers || {}) },
    body: JSON.stringify(body),
  });
  const response = await worker.fetch(request, env);
  return { response, body: await response.json() };
}

test("disabled receiver preserves purchase and does not expose the source token", async () => {
  const result = await call(environment());
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "receiver_disabled");
  assert.equal(result.body.purchase_allowed, true);
  assert.equal(result.body.attribution_recorded, false);
  assert.equal(result.body.checkout_created, false);
  assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.equal(result.response.headers.get("set-cookie"), null);
});

test("denied and unknown consent never invoke the receiver", async () => {
  let calls = 0;
  const env = environment({
    SOURCE_HANDOFF_ENABLED: "true",
    SOURCE_HANDOFF_RECEIVER: { receive: async () => { calls += 1; return { status: "accepted" }; } },
  });
  for (const consent of ["denied", "unknown"]) {
    const result = await call(env, input({ consent, source_token: undefined }));
    assert.equal(result.body.status, "privacy_no_tracking");
    assert.equal(result.body.purchase_allowed, true);
  }
  assert.equal(calls, 0);
});

test("invalid token and unavailable validation never block purchase", async () => {
  let calls = 0;
  const env = environment({
    SOURCE_HANDOFF_ENABLED: "true",
    SOURCE_HANDOFF_RECEIVER: { receive: async () => { calls += 1; throw new Error("offline"); } },
  });
  const invalid = await call(env, input({ source_token: "short" }));
  assert.equal(invalid.body.status, "invalid_token");
  assert.equal(calls, 0);
  const unavailable = await call(env);
  assert.equal(unavailable.body.status, "receiver_unavailable");
  assert.equal(unavailable.body.purchase_allowed, true);
  assert.equal(unavailable.body.attribution_recorded, false);
  assert.equal(calls, 1);
});

test("receiver timeout aborts validation but preserves the purchase path", async () => {
  let signal;
  const result = await call(environment({
    SOURCE_HANDOFF_ENABLED: "true",
    SOURCE_HANDOFF_TIMEOUT_MS: "100",
    SOURCE_HANDOFF_RECEIVER: {
      receive: async (request) => {
        signal = request.signal;
        return new Promise(() => {});
      },
    },
  }));
  assert.equal(result.body.status, "receiver_unavailable");
  assert.equal(result.body.purchase_allowed, true);
  assert.equal(result.body.attribution_recorded, false);
  assert.equal(signal.aborted, true);
});

test("receiver owns first-valid-source semantics and BFF reports its closed result", async () => {
  const claimed = new Set();
  const env = environment({
    SOURCE_HANDOFF_ENABLED: "true",
    SOURCE_HANDOFF_RECEIVER: {
      receive: async ({ token }) => {
        if (claimed.has(token)) return { status: "already_attributed" };
        claimed.add(token);
        return { status: "accepted" };
      },
    },
  });
  const first = await call(env);
  const second = await call(env, input({ source: "broader_public_catalog" }));
  assert.equal(first.body.status, "accepted");
  assert.equal(first.body.attribution_recorded, true);
  assert.equal(second.body.status, "already_attributed");
  assert.equal(second.body.attribution_recorded, false);
});

test("invalid receiver response cannot become strong attribution", async () => {
  const result = await call(environment({
    SOURCE_HANDOFF_ENABLED: "true",
    SOURCE_HANDOFF_RECEIVER: { receive: async () => ({ status: "maybe" }) },
  }));
  assert.equal(result.body.status, "receiver_unavailable");
  assert.equal(result.body.attribution_recorded, false);
});

test("malicious or cross-store PDP URLs and extra input fields are rejected", async () => {
  for (const product_url of [
    "javascript:alert(1)",
    "https://127.0.0.1/products/fixture-01",
    "https://other.example.invalid/products/fixture-01",
    `${STOREFRONT}/products/fixture-01?source=token`,
  ]) {
    const result = await call(environment(), input({ product_url }));
    assert.equal(result.response.status, 400);
    assert.equal(result.body.error, "invalid_request");
  }
  const extra = await call(environment(), { ...input(), order_id: "never" });
  assert.equal(extra.response.status, 400);
  assert.equal(extra.body.error, "invalid_request");
});

test("same-origin ingress protects the handoff endpoint", async () => {
  const request = new Request("http://127.0.0.1/api/source-handoff", {
    method: "POST",
    headers: { origin: "https://attacker.example.invalid", "content-type": "application/json" },
    body: JSON.stringify(input()),
  });
  const response = await worker.fetch(request, environment());
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "origin_not_allowed", expected_mode: "managed_public_catalog" });
});

test("source handoff is unavailable outside the managed profile", async () => {
  const result = await call(environment({ BFF_RUNTIME_MODE: "synthetic_local_sandbox" }));
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "runtime_mode_mismatch");
});

function signedProxyUrl(pathname, secret, shop, timestamp) {
  const params = new URLSearchParams({ shop, timestamp: String(timestamp) });
  const message = [...params.keys()].sort().map((key) => `${key}=${params.get(key)}`).join("");
  params.set("signature", createHmac("sha256", secret).update(message).digest("hex"));
  return `https://proxy.example.invalid${pathname}?${params}`;
}

test("managed source handoff inherits App Proxy HMAC and timestamp verification", async () => {
  const secret = "visibly_fake_shopify_app_proxy_secret";
  const shop = "reference-sandbox.myshopify.com";
  const env = environment({
    BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
    SHOPIFY_APP_PROXY_SECRET: secret,
    SHOPIFY_APP_PROXY_SHOP: shop,
  });
  const unsigned = await worker.fetch(new Request("https://proxy.example.invalid/api/source-handoff", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input()),
  }), env);
  assert.equal(unsigned.status, 401);
  assert.equal((await unsigned.json()).error, "app_proxy_authentication_failed");

  const accepted = await worker.fetch(new Request(
    signedProxyUrl("/api/source-handoff", secret, shop, Math.floor(Date.now() / 1000)),
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input()) },
  ), env);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).status, "receiver_disabled");
});
