import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.js";

const origin = "https://reference-demo.example.invalid";
const env = {
  ASSETS: {
    async fetch(request) {
      return new Response(`<h1>${new URL(request.url).pathname}</h1>`, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "must-not-reach-browser=1",
        },
      });
    },
  },
};

function call(path, init = {}) {
  return worker.fetch(new Request(`${origin}${path}`, init), env);
}

test("hosted status and doctor expose only the closed synthetic boundary", async () => {
  for (const path of ["/api/runtime/status", "/api/runtime/doctor"]) {
    const response = await call(path);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    const runtime = path.endsWith("doctor") ? body.runtime : body;
    assert.equal(runtime.mode, "synthetic_local_sandbox");
    assert.equal(runtime.connected, true);
    assert.equal(runtime.credential_state, "mock_ready");
    assert.equal(runtime.writes_disabled, true);
    assert.equal(runtime.boundaries.purchasable, false);
    assert.equal(runtime.boundaries.shipping_rates, false);
    assert.equal(runtime.boundaries.commerce_writes, false);
    assert.equal(runtime.boundaries.credential_exposed, false);
  }
});

test("hosted run is deterministic, illustrative, non-transactional, and uncookied", async () => {
  const response = await call("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "A practical desk gift under $40" }),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(body.runtime.mode, "synthetic_local_sandbox");
  assert.equal(body.search.status, "results");
  assert.ok(body.search.results.length > 0);
  for (const product of body.search.results) {
    assert.equal(product.synthetic, true);
    assert.equal(product.purchasable, false);
    assert.equal(product.available_for_sale, false);
    assert.equal(product.product_url, "");
    assert.equal(product.writes, false);
    assert.equal(product.shipping_rates, false);
  }
});

test("hosted API rejects unknown fields, oversized bodies, query strings, and unknown routes", async () => {
  const invalid = await call("/api/runs", {
    method: "POST",
    body: JSON.stringify({ query: "desk", token: "visibly-fake-value" }),
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_request" });

  const oversized = await call("/api/runs", {
    method: "POST",
    headers: { "content-length": String(32 * 1024 + 1) },
    body: "{}",
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { error: "request_too_large" });

  assert.equal((await call("/api/runtime/status?mode=shopify_read_only")).status, 400);
  assert.equal((await call("/api/unknown")).status, 404);
  assert.equal((await call("/api/runtime/status", { method: "POST" })).status, 405);
});

test("hosted static responses remove cookies and add browser security headers", async () => {
  const response = await call("/");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=()");
  assert.match(await response.text(), /<h1>\/<\/h1>/u);
});
