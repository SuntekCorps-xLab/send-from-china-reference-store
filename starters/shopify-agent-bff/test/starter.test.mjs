import assert from "node:assert/strict";
import test from "node:test";

import { searchThroughBff } from "../browser/search.mjs";
import worker from "../src/index.js";

const env = {
  AGENT_CORE_BASE_URL: "https://core.example.test",
  AGENT_CORE_TENANT_KEY: "obvious_test_value_not_a_secret",
  STOREFRONT_ORIGIN: "https://store.example.test",
  ALLOWED_ORIGINS: "https://store.example.test",
};

test("starter imports the canonical BFF and keeps health configuration-free", async () => {
  const response = await worker.fetch(new Request("https://bff.example.test/health"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "send-from-china-storefront-bff" });
});

test("browser adapter sends no credential and returns the BFF response", async () => {
  let captured;
  const payload = await searchThroughBff("desk organizer", {
    bffBaseUrl: "https://bff.example.test",
    fetch: async (request, init) => {
      captured = new Request(request, init);
      return Response.json({ status: "results", results: [] });
    },
  });
  assert.equal(captured.url, "https://bff.example.test/api/search");
  assert.equal(captured.headers.has("authorization"), false);
  assert.equal(captured.credentials, "omit");
  assert.deepEqual(await captured.json(), { q: "desk organizer" });
  assert.equal(payload.status, "results");
});

test("browser adapter rejects insecure non-loopback transport", async () => {
  await assert.rejects(
    searchThroughBff("desk", { bffBaseUrl: "http://store.example.test", fetch: async () => Response.json({}) }),
    /HTTPS/u,
  );
});
