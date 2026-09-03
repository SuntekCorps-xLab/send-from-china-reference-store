import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import * as demoServerModule from "../server.mjs";

const { startDemo } = demoServerModule;

async function withDemo(options, run) {
  const demo = await startDemo({ port: 0, ...options });
  try {
    await run(demo.baseUrl, demo);
  } finally {
    await demo.close();
  }
}

async function startFakeAgentCore({
  token = "local_sandbox_token_must_not_reach_the_browser",
  identity = "valid",
  authStatus = 200,
  chatStatus = 200,
} = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method,
      path: url.pathname,
      authorization: String(request.headers.authorization || ""),
      body,
    });

    if (request.method === "GET" && url.pathname === "/sandbox/status") {
      const headers = { "content-type": "application/json" };
      if (identity === "valid") {
        headers["x-send-from-china-sandbox-mode"] = "synthetic_local_sandbox";
        headers["x-send-from-china-sandbox-boundary"] = "synthetic-fixture; no-shipping-rates; no-commerce-writes";
      }
      response.writeHead(200, headers);
      response.end(JSON.stringify({
        mode: identity === "valid" ? "synthetic_local_sandbox" : "unknown_local_service",
        data_source: "synthetic_fixture",
        purchasable: false,
        shipping_rates: false,
        commerce_writes: false,
        credential_exposed: false,
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      response.writeHead(authStatus, { "content-type": "application/json" });
      response.end(authStatus === 200
        ? JSON.stringify({ mode: "published_snapshot", items: [] })
        : JSON.stringify({ error: { code: "INVALID_TENANT_KEY" } }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      response.writeHead(chatStatus, { "content-type": "application/json" });
      response.end(chatStatus === 200 ? JSON.stringify({
        reply: "One synthetic sandbox result is available.",
        products: [{
          public_id: "pub_connected_synthetic",
          slug: "connected-synthetic-product",
          title: "Connected synthetic product",
          price: { amount: 29, currency: "USD" },
          availability_band: "available",
          purchasable: true,
          product_url: "https://sandbox-store.example.invalid/products/connected-synthetic-product",
          add_to_cart_url: "https://sandbox-store.example.invalid/cart/add?id=synthetic",
        }],
      }) : JSON.stringify({ error: { code: "UPSTREAM_FAILURE" } }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    token,
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("the zero-account demo stays offline and labels every result as illustrative", async (context) => {
  const clientFetch = globalThis.fetch.bind(globalThis);
  const outbound = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("the simulated demo must not make outbound requests");
  });
  await withDemo({}, async (baseUrl) => {
    const page = await clientFetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Find the right product from China/);

    const chat = await clientFetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "gift under $40" }], scenario: "catalog_match" }),
    });
    const payload = await chat.json();
    assert.equal(payload.results.length, 3);
    assert.match(payload.reply, /gift under \$40/);
    assert.equal(payload.mode, "synthetic_demo");
    assert.equal(payload.live_agent_core, false);
    assert.equal(payload.boundaries.shipping_rates, false);
    assert.equal(payload.boundaries.commerce_writes, false);
    assert.ok(payload.results.every((result) => result.match_status === "illustrative_only"));
    assert.ok(payload.results.every((result) => result.synthetic && result.illustrative));
    assert.ok(payload.results.every((result) => !result.purchasable && !result.available));
  });
  assert.equal(outbound.mock.callCount(), 0);
});

test("the zero-account demo implements POST /api/search with an explicit synthetic contract", async () => {
  await withDemo({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "desk organizer under $40" }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.contract_version, "2.0");
    assert.equal(payload.status, "results");
    assert.equal(payload.mode, "synthetic_demo");
    assert.equal(payload.data_source, "offline_fixtures");
    assert.ok(payload.results.length > 0);
    assert.ok(payload.results.every((result) => result.synthetic && result.illustrative));
    assert.ok(payload.results.every((result) => !result.purchasable && !result.available));
  });
});

test("the simulated demo exposes terminal miss without creating a sourcing task", async () => {
  await withDemo({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "terminal_miss",
        messages: [{ role: "user", content: "an impossible product" }],
      }),
    });
    const payload = await response.json();
    assert.equal(payload.status, "no_match");
    assert.deepEqual(payload.results, []);
    assert.equal(payload.dynamic_request_recommended, true);
    assert.equal(payload.next_actions[0].operation, "preview_only");
    assert.equal(payload.search_scope.plan_complete, true);
    assert.match(payload.reply, /no external sourcing task was created/i);

    for (const route of ["/api/sourcing", "/api/catalog", "/api/cart", "/api/order", "/api/payment", "/mcp"]) {
      const blocked = await fetch(`${baseUrl}${route}`, { method: "POST" });
      assert.equal(blocked.status, 404, `${route} must remain unavailable`);
    }
  });
});

test("the simulated demo validates requests and reports its complete safety boundary", async () => {
  await withDemo({}, async (baseUrl) => {
    const empty = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "  " }] }),
    });
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { error: "invalid_messages" });

    const invalid = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "invalid_json" });

    const oversized = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(40_000) }] }),
    });
    assert.equal(oversized.status, 413);
    assert.deepEqual(await oversized.json(), { error: "request_too_large" });

    const status = await fetch(`${baseUrl}/api/status`);
    assert.deepEqual(await status.json(), {
      ok: true,
      mode: "synthetic_demo",
      data_source: "offline_fixtures",
      live_agent_core: false,
      synthetic: true,
      illustrative: true,
      purchasable: false,
      commerce_writes: false,
      shipping_rates: false,
    });
  });
});

test("connected mode verifies sandbox identity and auth, supports a real dynamic Origin, and keeps its token server-side", async () => {
  const upstream = await startFakeAgentCore();
  await withDemo({
    mode: "connected",
    agentCoreBaseUrl: upstream.baseUrl,
    agentCoreToken: upstream.token,
  }, async (baseUrl) => {
    const statusResponse = await fetch(`${baseUrl}/api/status`);
    const statusText = await statusResponse.text();
    assert.equal(statusText.includes(upstream.token), false);
    assert.deepEqual(JSON.parse(statusText), {
      ok: true,
      mode: "connected_local_sandbox",
      data_source: "agent_core_synthetic_snapshot",
      live_agent_core: true,
      configured: true,
      reachable: true,
      sandbox_identity_verified: true,
      auth_verified: true,
      verified: true,
      readiness: "ready",
      reason: null,
      synthetic: true,
      illustrative: true,
      purchasable: false,
      commerce_writes: false,
      shipping_rates: false,
    });

    const chatResponse = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        origin: baseUrl,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "connected product" }] }),
    });
    assert.equal(chatResponse.status, 200);
    const chatText = await chatResponse.text();
    assert.equal(chatText.includes(upstream.token), false);
    const chat = JSON.parse(chatText);
    assert.equal(chat.mode, "connected_local_sandbox");
    assert.equal(chat.data_source, "agent_core_synthetic_snapshot");
    assert.equal(chat.verified, true);
    assert.equal(chat.results[0].purchasable, false);
    assert.equal(chat.results[0].available, false);
    assert.equal(chat.results[0].product_url, "");
    assert.equal(chat.results[0].add_to_cart_url, "");
    assert.equal(chat.results[0].match_status, "illustrative_only");
    assert.equal(chat.boundaries.shipping_rates, false);
    assert.equal(chat.boundaries.commerce_writes, false);

    const pageText = await (await fetch(`${baseUrl}/`)).text();
    assert.equal(pageText.includes(upstream.token), false);
    const authenticated = upstream.requests.filter((request) => ["/api/search", "/api/chat"].includes(request.path));
    assert.ok(authenticated.length >= 2);
    assert.ok(authenticated.every((request) => request.authorization === `Bearer ${upstream.token}`));
  });
  await upstream.close();
});

test("connected status reports configured but unavailable and blocks calls when upstream is down", async () => {
  const placeholder = createServer();
  await new Promise((resolve) => placeholder.listen(0, "127.0.0.1", resolve));
  const unavailableUrl = `http://127.0.0.1:${placeholder.address().port}`;
  await new Promise((resolve) => placeholder.close(resolve));

  await withDemo({
    mode: "connected",
    agentCoreBaseUrl: unavailableUrl,
    agentCoreToken: "operator_issued_test_token",
    readinessTimeoutMs: 100,
  }, async (baseUrl) => {
    const status = await (await fetch(`${baseUrl}/api/status`)).json();
    assert.equal(status.ok, false);
    assert.equal(status.configured, true);
    assert.equal(status.reachable, false);
    assert.equal(status.verified, false);
    assert.equal(status.live_agent_core, false);
    assert.equal(status.readiness, "unavailable");
    assert.equal(status.data_source, "unverified_local_agent_core");

    const chat = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "desk" }] }),
    });
    assert.equal(chat.status, 503);
    const payload = await chat.json();
    assert.equal(payload.error, "sandbox_not_ready");
    assert.equal(payload.live_agent_core, false);
    assert.notEqual(payload.status, "no_match");
  });
});

test("connected status distinguishes an unverified service from tenant authentication failure", async () => {
  const unverified = await startFakeAgentCore({ identity: "invalid" });
  try {
    await withDemo({
      mode: "connected",
      agentCoreBaseUrl: unverified.baseUrl,
      agentCoreToken: unverified.token,
    }, async (baseUrl) => {
      const status = await (await fetch(`${baseUrl}/api/status`)).json();
      assert.equal(status.reachable, true);
      assert.equal(status.sandbox_identity_verified, false);
      assert.equal(status.auth_verified, false);
      assert.equal(status.verified, false);
      assert.equal(status.readiness, "unverified");
      assert.equal(status.reason, "sandbox_identity_unverified");
      assert.equal(unverified.requests.some((request) => request.path === "/api/search"), false);
    });
  } finally {
    await unverified.close();
  }

  const unauthenticated = await startFakeAgentCore({ authStatus: 401 });
  try {
    await withDemo({
      mode: "connected",
      agentCoreBaseUrl: unauthenticated.baseUrl,
      agentCoreToken: unauthenticated.token,
    }, async (baseUrl) => {
      const status = await (await fetch(`${baseUrl}/api/status`)).json();
      assert.equal(status.reachable, true);
      assert.equal(status.sandbox_identity_verified, true);
      assert.equal(status.auth_verified, false);
      assert.equal(status.verified, false);
      assert.equal(status.live_agent_core, false);
      assert.equal(status.readiness, "authentication_failed");
      assert.equal(status.reason, "tenant_authentication_failed");
      assert.equal(JSON.stringify(status).includes(unauthenticated.token), false);
    });
  } finally {
    await unauthenticated.close();
  }
});

test("connected configuration fails closed and the raw server factory is not exported", async () => {
  assert.equal("createDemoServer" in demoServerModule, false);
  await assert.rejects(
    startDemo({ mode: "connected", port: 0 }),
    /connected_mode_requires_agent_core/,
  );
  await assert.rejects(
    startDemo({
      mode: "connected",
      port: 0,
      agentCoreBaseUrl: "https://agent-core.example.invalid",
      agentCoreToken: "local_test_token",
    }),
    /connected_mode_requires_loopback_agent_core/,
  );
});

test("the demo refuses a non-loopback bind address", async () => {
  await assert.rejects(
    startDemo({ host: "0.0.0.0", port: 0 }),
    /demo_requires_loopback_host/,
  );
});
