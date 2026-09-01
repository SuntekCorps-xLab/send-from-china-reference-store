import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  candidateShopifyAgentCoreDirectories,
  resolveShopifyAgentCoreDirectory,
  startShopifyPlatform,
} from "../../scripts/demo-shopify.mjs";

test("Shopify launcher resolves only the explicit Agent Core code directory", async () => {
  const cwd = path.resolve("fixture", "reference-store");
  const expected = path.resolve(cwd, "..", "agent-core-s1");
  assert.deepEqual(candidateShopifyAgentCoreDirectories({
    args: ["--agent-core", "../agent-core-s1"],
    env: { AGENT_CORE_DIR: "../ignored" },
    cwd,
  }), [expected]);
  assert.equal(await resolveShopifyAgentCoreDirectory({
    args: ["--agent-core=../agent-core-s1"],
    cwd,
    exists: async (file) => file === path.join(expected, "sandbox", "shopify-server.mjs"),
  }), expected);
});

test("Shopify launcher keeps configuration server-side and closes demo before sandbox", async () => {
  const events = [];
  const environment = {
    SHOPIFY_STORE_DOMAIN: "reference-sandbox.myshopify.com",
    SHOPIFY_STOREFRONT_ACCESS_TOKEN: "fake_server_only_test_token",
  };
  let demoOptions;
  const runtime = await startShopifyPlatform({
    environment,
    sandboxPort: 18787,
    demoPort: 14173,
    startVerifiedShopifySandbox: async (options) => {
      assert.equal(options.environment, environment);
      assert.deepEqual({ port: options.port, host: options.host }, { port: 18787, host: "127.0.0.1" });
      return {
        status: { mode: "shopify_read_only", verified: true, credential_state: "succeeded" },
        sandbox: {
          baseUrl: "http://127.0.0.1:18787",
          token: "generated_local_sandbox_token",
          async close() { events.push("sandbox"); },
        },
      };
    },
    startReferenceDemo: async (options) => {
      demoOptions = options;
      return {
        baseUrl: "http://127.0.0.1:14173",
        async close() { events.push("demo"); },
      };
    },
  });
  assert.equal(runtime.url, "http://127.0.0.1:14173");
  assert.deepEqual(demoOptions, {
    mode: "shopify",
    port: 14173,
    host: "127.0.0.1",
    quiet: true,
    verifyRuntime: true,
    agentCoreSandboxUrl: "http://127.0.0.1:18787",
    agentCoreSandboxToken: "generated_local_sandbox_token",
    storefrontOrigin: "https://reference-sandbox.myshopify.com",
  });
  assert.equal(JSON.stringify(demoOptions).includes(environment.SHOPIFY_STOREFRONT_ACCESS_TOKEN), false);
  await runtime.close();
  await runtime.close();
  assert.deepEqual(events, ["demo", "sandbox"]);
});

test("Shopify launcher fails closed for missing credentials and cleans partial runtimes", async () => {
  let demoStarts = 0;
  await assert.rejects(startShopifyPlatform({
    environment: { SHOPIFY_STORE_DOMAIN: "reference-sandbox.myshopify.com" },
    startVerifiedShopifySandbox: async () => ({
      status: {
        mode: "shopify_read_only",
        verified: false,
        credential_state: "credential_missing",
        private_detail: "must not escape",
      },
      sandbox: null,
    }),
    startReferenceDemo: async () => { demoStarts += 1; },
  }), /^Error: shopify_sandbox_not_ready:credential_missing$/u);
  assert.equal(demoStarts, 0);

  const events = [];
  await assert.rejects(startShopifyPlatform({
    environment: { SHOPIFY_STORE_DOMAIN: "reference-sandbox.myshopify.com" },
    startVerifiedShopifySandbox: async () => ({
      status: { mode: "shopify_read_only", verified: true, credential_state: "succeeded" },
      sandbox: {
        baseUrl: "http://127.0.0.1:18787",
        async close() { events.push("sandbox"); },
      },
    }),
    startReferenceDemo: async () => { throw new Error("demo_failed"); },
  }), /demo_failed/u);
  assert.deepEqual(events, ["sandbox"]);
});

test("Shopify launcher requires literal 127.0.0.1 and a public HTTPS storefront", async () => {
  for (const host of ["localhost", "::1", "0.0.0.0"]) {
    await assert.rejects(startShopifyPlatform({
      host,
      environment: { SHOPIFY_STORE_DOMAIN: "reference-sandbox.myshopify.com" },
      startVerifiedShopifySandbox: async () => { throw new Error("must not start"); },
    }), /shopify_demo_requires_127_0_0_1/u);
  }
  for (const origin of [
    "https://127.0.0.1",
    "https://store.local",
    "https://store.example.invalid:443",
    "https://user:pass@store.example.invalid",
  ]) {
    await assert.rejects(startShopifyPlatform({
      environment: { STOREFRONT_ORIGIN: origin },
      startVerifiedShopifySandbox: async () => { throw new Error("must not start"); },
    }), /shopify_storefront_origin_required/u);
  }
});
