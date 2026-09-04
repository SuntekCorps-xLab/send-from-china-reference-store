import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { startDemo } from "../../demo/server.mjs";

const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
const compactReadme = readme.replace(/\s+/gu, " ");

function inOrder(text, literals) {
  let position = 0;
  for (const literal of literals) {
    const found = text.indexOf(literal, position);
    assert.ok(found >= position, `missing or out-of-order first-run instruction: ${literal}`);
    position = found + literal.length;
  }
}

test("zero-account README gives one complete clean-checkout path", () => {
  const section = readme.match(/## ⚡ See it in 60 seconds(?<body>[\s\S]*?)### Demo and connected modes/u)?.groups?.body;
  assert.ok(section, "zero-account demo section is missing");
  inOrder(section, [
    "Node.js 22.x",
    "npm 10.x",
    "git clone --depth 1 https://github.com/SuntekCorps-xLab/send-from-china-reference-store.git",
    "cd send-from-china-reference-store",
    "node --version",
    "npm --version",
    "npm ci",
    "npm run test:first-run",
    "npm run demo",
    "Reference Store offline demo: http://127.0.0.1:4173",
    "curl -fsS http://127.0.0.1:4173/health",
    "curl -fsS http://127.0.0.1:4173/api/status",
    'mode: "synthetic_demo"',
    'data_source: "offline_fixtures"',
    "Ctrl",
  ]);
});

test("README separates fixtures from credentialed BFF, App Proxy, and commerce", () => {
  for (const literal of [
    "fixture-only `/api/chat`, `/api/search`, `/api/runtime/status`",
    "`/api/runtime/doctor`, and `/api/runs` responses",
    "not evidence that an Agent Core, Shopify store, BFF, or App Proxy is connected",
    "do not use `npm run demo:connected`",
    "`npm run demo:shopify`",
    "Shopify cart, checkout, account, order, or payment routes",
    "merchant-controlled same-origin BFF/App Proxy",
  ]) assert.ok(compactReadme.includes(literal), `missing boundary instruction: ${literal}`);
});

test("zero-account runtime matches the documented health and status contracts", async () => {
  const demo = await startDemo({ port: 0 });
  try {
    const healthResponse = await fetch(`${demo.baseUrl}/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(health, {
      ok: true,
      service: "send-from-china-reference-demo",
      mode: "simulated",
    });

    const statusResponse = await fetch(`${demo.baseUrl}/api/status`);
    const status = await statusResponse.json();
    assert.equal(statusResponse.status, 200);
    assert.equal(statusResponse.headers.get("cache-control"), "no-store");
    assert.equal(statusResponse.headers.get("set-cookie"), null);
    assert.equal(status.mode, "synthetic_demo");
    assert.equal(status.data_source, "offline_fixtures");
    assert.equal(status.live_agent_core, false);
    assert.equal(status.purchasable, false);
    assert.equal(status.commerce_writes, false);

    for (const route of ["/api/catalog", "/mcp", "/cart", "/checkout", "/account", "/orders", "/payment"]) {
      assert.equal((await fetch(`${demo.baseUrl}${route}`)).status, 404, `${route} must remain unavailable`);
    }
  } finally {
    await demo.close();
  }
});
