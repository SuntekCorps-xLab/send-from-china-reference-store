import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import worker, {
  projectRuntimeStatus,
  validateSandboxStatus,
} from "../src/index.js";

const CHECKED_AT = "2026-08-31T00:00:00.000Z";
const VERIFIED_AT = "2026-08-31T00:00:01.000Z";
const FAKE_TOKEN = "visibly_fake_agent_core_sandbox_token";
const STOREFRONT = "https://sandbox-store.example.invalid";

function runtimeEnv(mode = "synthetic_local_sandbox", overrides = {}) {
  return {
    AGENT_CORE_SANDBOX_URL: "https://agent-core.example.invalid",
    AGENT_CORE_SANDBOX_TOKEN: FAKE_TOKEN,
    BFF_RUNTIME_MODE: mode,
    BFF_DEPLOYMENT_MODE: "local",
    STOREFRONT_ORIGIN: STOREFRONT,
    ALLOWED_ORIGINS: STOREFRONT,
    ...overrides,
  };
}

function capabilities(reads, storefrontHealth = reads) {
  return {
    doctor: true,
    catalog_search: reads,
    search_contract_v2: reads,
    product_detail: reads,
    storefront_health: storefrontHealth,
    cart: false,
    checkout: false,
    order: false,
    payment: false,
    inventory: false,
    publication: false,
    product_mutation: false,
  };
}

function statusFixture(mode = "synthetic_local_sandbox", state = "succeeded") {
  const synthetic = mode === "synthetic_local_sandbox";
  const verified = synthetic || state === "succeeded";
  const codeByState = {
    credential_missing: "CREDENTIAL_MISSING",
    authentication_failed: "AUTHENTICATION_FAILED",
    permission_required: "PERMISSION_REQUIRED",
    quota_exceeded: "QUOTA_EXCEEDED",
    service_unavailable: "SERVICE_UNAVAILABLE",
  };
  return {
    contract: "shopify-live-sandbox-status/v1",
    mode,
    verified,
    credential_state: synthetic ? "mock_ready" : state,
    data_source: synthetic ? "synthetic_fixture" : "shopify_storefront_graphql",
    api_version: synthetic ? null : "2026-07",
    quota: synthetic
      ? { limit: 0, remaining: 0, window_seconds: 0, concurrency_limit: 0, reset_at: null }
      : { limit: 100, remaining: 97, window_seconds: 60, concurrency_limit: 4, reset_at: CHECKED_AT },
    writes: false,
    non_transactional: true,
    capabilities: capabilities(verified, synthetic ? false : verified),
    checked_at: CHECKED_AT,
    error_code: verified ? null : codeByState[state],
    purchasable: false,
    shipping_rates: false,
    commerce_writes: false,
    credential_exposed: false,
  };
}

function condition(query = "desk organizer") {
  return { name: "product_identity", value: query, source: "explicit", scope: "product", hardness: "hard" };
}

function productFixture(mode = "synthetic_local_sandbox", overrides = {}) {
  const live = mode === "shopify_read_only";
  return {
    public_id: live ? "0123456789abcdefABCDEF" : "pub_synthetic_reference",
    slug: "verified-desk-organizer",
    handle: "verified-desk-organizer",
    title: live ? "Verified desk organizer" : "Synthetic desk organizer",
    description: live ? "Published Shopify product data." : "Illustrative fixture data.",
    images: [],
    price: { amount: 19.95, currency: "USD" },
    availability_band: live ? "in_stock" : "demo_only",
    as_of: live ? VERIFIED_AT : CHECKED_AT,
    purchasable: false,
    ...(live ? { product_url: `${STOREFRONT}/products/verified-desk-organizer` } : {}),
    availableForSale: live,
    shopify_verified_at: live ? VERIFIED_AT : null,
    non_transactional: true,
    transaction_boundary: "catalog_read_only_non_transactional",
    writes: false,
    mode,
    data_source: live ? "shopify_storefront_graphql" : "synthetic_fixture",
    illustrative_only: !live,
    available: false,
    ...overrides,
  };
}

function searchFixture(mode = "synthetic_local_sandbox", overrides = {}) {
  const live = mode === "shopify_read_only";
  const product = productFixture(mode);
  return {
    contract_version: "2.0",
    trace_id: live ? "shopify-sandbox-test-trace" : "synthetic-sandbox-test-trace",
    status: "results",
    normalized_intent: {
      product_identity: condition(),
      hard_constraints: [],
      soft_context: [],
      transaction_context: [],
    },
    relaxations: [],
    missing_criteria: [],
    results: [product],
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
    mode,
    data_source: live ? "shopify_storefront_graphql" : "synthetic_fixture",
    illustrative_only: !live,
    purchasable: false,
    available: false,
    writes: false,
    non_transactional: true,
    transaction_boundary: "catalog_read_only_non_transactional",
    shopify_verified_at: live ? VERIFIED_AT : null,
    ...overrides,
  };
}

function localCall(path, init = {}, env = runtimeEnv()) {
  return worker.fetch(new Request(`http://127.0.0.1:8788${path}`, init), env);
}

function jsonResponse(body, init = {}) {
  return Response.json(body, init);
}

function sequenceFetch(context, responses, inspect = () => {}) {
  let index = 0;
  return context.mock.method(globalThis, "fetch", async (input, init) => {
    inspect(new Request(input, init), index);
    const response = responses[index];
    index += 1;
    return typeof response === "function" ? response() : response;
  });
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

test("strictly validates S1 status and projects only the closed BFF runtime fields", () => {
  for (const mode of ["synthetic_local_sandbox", "shopify_read_only"]) {
    const source = statusFixture(mode);
    assert.equal(validateSandboxStatus(source), true);
    const runtime = projectRuntimeStatus(source, mode);
    assert.deepEqual(sortedKeys(runtime), [
      "api_version", "boundaries", "capabilities", "checked_at", "connected", "contract",
      "credential_state", "data_source", "error_code", "mode", "quota", "source_contract",
      "writes_disabled",
    ].sort());
    assert.equal(runtime.contract, "reference-store-runtime-status/v1");
    assert.equal(runtime.source_contract, "shopify-live-sandbox-status/v1");
    assert.equal(runtime.writes_disabled, true);
    assert.deepEqual(sortedKeys(runtime.capabilities), [
      "doctor", "catalog_search", "search_contract_v2", "product_detail", "storefront_health",
    ].sort());
    assert.deepEqual(runtime.boundaries, {
      non_transactional: true,
      purchasable: false,
      shipping_rates: false,
      commerce_writes: false,
      credential_exposed: false,
    });
  }

  const invalid = statusFixture();
  invalid.unexpected = true;
  assert.equal(validateSandboxStatus(invalid), false);
  assert.throws(() => projectRuntimeStatus(invalid, invalid.mode), /invalid_upstream_contract/u);
  assert.throws(
    () => projectRuntimeStatus(statusFixture(), "shopify_read_only"),
    /runtime_mode_mismatch/u,
  );
});

test("synthetic status, doctor, and run remain synthetic and issue only fixed sandbox calls", async (context) => {
  const status = statusFixture();
  const search = searchFixture();
  const seen = [];
  sequenceFetch(context, [
    jsonResponse(status),
    jsonResponse(status),
    jsonResponse(status),
    jsonResponse(search),
  ], (request) => seen.push(request));
  const env = runtimeEnv();

  const statusResponse = await localCall("/api/runtime/status", {}, env);
  assert.equal(statusResponse.status, 200);
  assert.equal(statusResponse.headers.get("cache-control"), "no-store");
  const runtime = await statusResponse.json();
  assert.equal(runtime.mode, "synthetic_local_sandbox");
  assert.equal(runtime.connected, true);

  const doctorResponse = await localCall("/api/runtime/doctor", {}, env);
  assert.equal(doctorResponse.status, 200);
  const doctor = await doctorResponse.json();
  assert.deepEqual(sortedKeys(doctor), ["checks", "contract", "ok", "runtime"].sort());
  assert.equal(doctor.contract, "reference-store-runtime-doctor/v1");
  assert.equal(doctor.ok, true);

  const runResponse = await localCall("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "desk organizer" }),
  }, env);
  assert.equal(runResponse.status, 200);
  const run = await runResponse.json();
  assert.equal(run.contract, "reference-store-read-run/v1");
  assert.deepEqual(run.runtime, runtime);
  assert.equal(run.search.results[0].synthetic, true);
  assert.equal(run.search.results[0].product_url, "");
  assert.equal(run.search.results[0].shopify_verified_at, null);
  assert.equal(run.search.results[0].available_for_sale, false);
  assert.deepEqual(sortedKeys(run.search.results[0]), [
    "available_for_sale", "handle", "image", "non_transactional", "price", "product_url",
    "public_id", "purchasable", "shipping_rates", "shopify_verified_at", "summary", "synthetic",
    "title", "writes",
  ].sort());

  assert.deepEqual(seen.map((request) => new URL(request.url).pathname), [
    "/sandbox/status", "/sandbox/status", "/sandbox/status", "/sandbox/api/search/v2",
  ]);
  for (const request of seen) assert.equal(request.headers.get("authorization"), `Bearer ${FAKE_TOKEN}`);
  assert.equal(JSON.stringify({ runtime, doctor, run }).includes(FAKE_TOKEN), false);
  assert.equal(await seen[3].clone().json().then((body) => body.contract_version), "2.0");
});

test("Shopify run returns only verified read-only product facts and exact frozen receipt values", async (context) => {
  const status = statusFixture("shopify_read_only");
  const search = searchFixture("shopify_read_only");
  sequenceFetch(context, [jsonResponse(status), jsonResponse(status), jsonResponse(search)]);
  const env = runtimeEnv("shopify_read_only");
  const statusResponse = await localCall("/api/runtime/status", {}, env);
  const expectedRuntime = await statusResponse.json();
  const response = await localCall("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "desk organizer" }),
  }, env);
  assert.equal(response.status, 200);
  const receiptText = await response.text();
  const receipt = JSON.parse(receiptText);
  assert.deepEqual(receipt.runtime, expectedRuntime);
  assert.deepEqual(receipt.search.results[0], {
    public_id: "0123456789abcdefABCDEF",
    handle: "verified-desk-organizer",
    title: "Verified desk organizer",
    summary: "Published Shopify product data.",
    image: "",
    price: { amount: 19.95, currency: "USD" },
    available_for_sale: true,
    product_url: `${STOREFRONT}/products/verified-desk-organizer`,
    shopify_verified_at: VERIFIED_AT,
    synthetic: false,
    non_transactional: true,
    purchasable: false,
    writes: false,
    shipping_rates: false,
  });
  assert.deepEqual(sortedKeys(receipt.search), [
    "contract_version", "missing_criteria", "normalized_intent", "pagination", "relaxations",
    "results", "search_scope", "status", "trace_id",
  ].sort());
  assert.equal(receiptText.includes("cart"), false);
  assert.equal(receiptText.includes("checkout"), false);
  assert.equal(receiptText.includes("payment"), false);
});

test("valid unverified Shopify statuses remain visible and runs fail without synthetic fallback", async (context) => {
  const states = [
    ["credential_missing", 503],
    ["authentication_failed", 502],
    ["permission_required", 502],
    ["quota_exceeded", 429],
    ["service_unavailable", 503],
  ];
  const responses = [];
  for (const [state] of states) responses.push(jsonResponse(statusFixture("shopify_read_only", state)));
  sequenceFetch(context, responses);

  for (const [state, expectedStatus] of states) {
    const env = runtimeEnv("shopify_read_only");
    const response = await localCall("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "desk organizer" }),
    }, env);
    assert.equal(response.status, expectedStatus);
    const body = await response.json();
    assert.equal(body.error, state);
    assert.equal(body.expected_mode, "shopify_read_only");
    assert.equal(body.runtime.mode, "shopify_read_only");
    assert.equal(body.runtime.connected, false);
    assert.notEqual(body.runtime.credential_state, "mock_ready");
  }
});

test("GET status exposes a valid credential-missing state with no silent mode change", async (context) => {
  sequenceFetch(context, [jsonResponse(statusFixture("shopify_read_only", "credential_missing"))]);
  const response = await localCall("/api/runtime/status", {}, runtimeEnv("shopify_read_only"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then((body) => ({
    mode: body.mode,
    connected: body.connected,
    state: body.credential_state,
    error: body.error_code,
  })), {
    mode: "shopify_read_only",
    connected: false,
    state: "credential_missing",
    error: "CREDENTIAL_MISSING",
  });
});

test("never reflects an upstream Retry-After value that could contain a credential", async (context) => {
  sequenceFetch(context, [jsonResponse({ error: "quota" }, {
    status: 429,
    headers: { "retry-after": FAKE_TOKEN },
  })]);
  const response = await localCall("/api/runtime/status", {}, runtimeEnv());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), null);
  const publicSurface = `${await response.text()}${JSON.stringify([...response.headers])}`;
  assert.equal(publicSurface.includes(FAKE_TOKEN), false);
});

test("rejects malformed status, mode mismatch, unavailable status, and upstream auth without bodies", async (context) => {
  const malformed = { ...statusFixture(), private_token: FAKE_TOKEN };
  sequenceFetch(context, [
    jsonResponse(malformed),
    jsonResponse(statusFixture("shopify_read_only")),
    jsonResponse({ error: { code: "SERVICE_UNAVAILABLE", detail: FAKE_TOKEN } }, { status: 503 }),
    jsonResponse({ error: { code: "AUTHENTICATION_FAILED", detail: FAKE_TOKEN } }, { status: 401 }),
  ]);
  const cases = [
    [runtimeEnv(), 502, "invalid_upstream_contract"],
    [runtimeEnv(), 502, "runtime_mode_mismatch"],
    [runtimeEnv(), 503, "service_unavailable"],
    [runtimeEnv(), 502, "authentication_failed"],
  ];
  for (const [env, expectedStatus, code] of cases) {
    const response = await localCall("/api/runtime/status", {}, env);
    assert.equal(response.status, expectedStatus);
    const text = await response.text();
    assert.equal(JSON.parse(text).error, code);
    assert.equal(text.includes(FAKE_TOKEN), false);
  }
});

test("fails the whole live run for every unsafe or noncanonical product URL", async (context) => {
  const unsafe = [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:password@sandbox-store.example.invalid/products/verified-desk-organizer",
    "https://127.0.0.1/products/verified-desk-organizer",
    "https://catalog.local/products/verified-desk-organizer",
    "https://other-store.example.invalid/products/verified-desk-organizer",
    "https://sandbox-store.example.invalid:444/products/verified-desk-organizer",
    "https://sandbox-store.example.invalid:443/products/verified-desk-organizer",
    "https://sandbox-store.example.invalid/products/other-handle",
    "https://sandbox-store.example.invalid/products/verified-desk-organizer?variant=1",
    "https://sandbox-store.example.invalid/products/verified-desk-organizer#buy",
    "https://sandbox-store.example.invalid/products/verified-desk-organizer/",
  ];
  const responses = unsafe.flatMap((productUrl) => [
    jsonResponse(statusFixture("shopify_read_only")),
    jsonResponse(searchFixture("shopify_read_only", {
      results: [productFixture("shopify_read_only", { product_url: productUrl })],
    })),
  ]);
  sequenceFetch(context, responses);
  for (const productUrl of unsafe) {
    const response = await localCall("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "desk organizer" }),
    }, runtimeEnv("shopify_read_only"));
    assert.equal(response.status, 502, productUrl);
    const body = await response.json();
    assert.equal(body.error, "invalid_shopify_product_url");
    assert.equal(body.runtime.mode, "shopify_read_only");
  }
});

test("rejects private or stateful STOREFRONT_ORIGIN configurations", async (context) => {
  const origins = [
    "http://sandbox-store.example.invalid",
    "https://user:pass@sandbox-store.example.invalid",
    "https://sandbox-store.example.invalid:444",
    "https://sandbox-store.example.invalid:443",
    "https://127.0.0.1",
    "https://store.local",
    "https://sandbox-store.example.invalid/path",
    "https://sandbox-store.example.invalid?mode=live",
  ];
  sequenceFetch(context, origins.flatMap(() => [
    jsonResponse(statusFixture("shopify_read_only")),
    jsonResponse(searchFixture("shopify_read_only")),
  ]));
  for (const origin of origins) {
    const response = await localCall("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "desk organizer" }),
    }, runtimeEnv("shopify_read_only", { STOREFRONT_ORIGIN: origin }));
    assert.equal(response.status, 502, origin);
    assert.equal((await response.json()).error, "invalid_shopify_product_url");
  }
});

test("browser query/body values cannot change mode or upstream sandbox paths", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call upstream");
  });
  const env = runtimeEnv();
  const querySwitch = await localCall("/api/runtime/status?mode=shopify_read_only", {}, env);
  assert.equal(querySwitch.status, 400);
  assert.equal((await querySwitch.json()).error, "invalid_request");

  const bodySwitch = await localCall("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "desk organizer", mode: "shopify_read_only" }),
  }, env);
  assert.equal(bodySwitch.status, 400);
  assert.equal((await bodySwitch.json()).error, "invalid_request");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("local deployment accepts only the literal 127.0.0.1 request host", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not call upstream");
  });
  for (const host of ["localhost", "[::1]", "bff.example.invalid", "127.0.0.2"]) {
    const response = await worker.fetch(
      new Request(`http://${host}:8788/api/runtime/status`), runtimeEnv(),
    );
    assert.equal(response.status, 403, host);
    assert.equal((await response.json()).error, "local_binding_required");
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

function signedProxyUrl(pathname, secret, shop, timestamp, extra = {}) {
  const params = new URLSearchParams({ shop, timestamp: String(timestamp), ...extra });
  const grouped = new Map();
  for (const [key, value] of params) {
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  const message = [...grouped.keys()].sort()
    .map((key) => `${key}=${grouped.get(key).join(",")}`).join("");
  params.set("signature", createHmac("sha256", secret).update(message).digest("hex"));
  return `https://proxy.example.invalid${pathname}?${params}`;
}

test("Shopify App Proxy requires an exact HMAC, configured shop, and fresh timestamp", async (context) => {
  const secret = "visibly_fake_shopify_app_proxy_secret";
  const shop = "reference-sandbox.myshopify.com";
  const timestamp = Math.floor(Date.now() / 1_000);
  const env = runtimeEnv("synthetic_local_sandbox", {
    BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
    SHOPIFY_APP_PROXY_SECRET: secret,
    SHOPIFY_APP_PROXY_SHOP: shop,
  });
  sequenceFetch(context, [jsonResponse(statusFixture())]);
  const accepted = await worker.fetch(new Request(
    signedProxyUrl("/api/runtime/status", secret, shop, timestamp, { path_prefix: "/apps/reference" }),
  ), env);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("cache-control"), "no-store");

  const badSignature = new URL(signedProxyUrl("/api/runtime/status", secret, shop, timestamp));
  badSignature.searchParams.set("signature", "0".repeat(64));
  const rejected = await worker.fetch(new Request(badSignature), env);
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).error, "app_proxy_authentication_failed");

  const stale = await worker.fetch(new Request(
    signedProxyUrl("/api/runtime/status", secret, shop, timestamp - 1_000),
  ), env);
  assert.equal(stale.status, 401);
  assert.equal((await stale.json()).error, "app_proxy_timestamp_expired");
});

test("App Proxy fails distinctly when server ingress configuration is missing", async () => {
  const response = await worker.fetch(new Request("https://proxy.example.invalid/api/runtime/status"),
    runtimeEnv("synthetic_local_sandbox", { BFF_DEPLOYMENT_MODE: "shopify_app_proxy" }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "deployment_not_configured");
});

test("App Proxy rejects oversized signed query state before HMAC work or quota", async () => {
  const secret = "visibly_fake_shopify_app_proxy_secret";
  const shop = "reference-sandbox.myshopify.com";
  const url = signedProxyUrl("/api/runtime/status", secret, shop, Math.floor(Date.now() / 1_000), {
    padding: "x".repeat(9 * 1024),
  });
  const response = await worker.fetch(new Request(url), runtimeEnv("synthetic_local_sandbox", {
    BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
    SHOPIFY_APP_PROXY_SECRET: secret,
    SHOPIFY_APP_PROXY_SHOP: shop,
  }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "request_too_large");
});

test("configured deployment ingress protects legacy BFF APIs too", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("unsigned request must not reach Agent Core");
  });
  const response = await worker.fetch(new Request("https://proxy.example.invalid/api/catalog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }), runtimeEnv("synthetic_local_sandbox", {
    BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
    SHOPIFY_APP_PROXY_SECRET: "visibly_fake_shopify_app_proxy_secret",
    SHOPIFY_APP_PROXY_SHOP: "reference-sandbox.myshopify.com",
    AGENT_CORE_BASE_URL: "https://agent.example.invalid",
    AGENT_CORE_TENANT_KEY: FAKE_TOKEN,
  }));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "app_proxy_authentication_failed");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("Shopify read-only runtime disables signed legacy APIs after ingress verification", async (context) => {
  const secret = "visibly_fake_shopify_app_proxy_secret";
  const shop = "reference-sandbox.myshopify.com";
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("disabled legacy route must not reach Agent Core");
  });
  const response = await worker.fetch(new Request(
    signedProxyUrl("/api/catalog", secret, shop, Math.floor(Date.now() / 1_000)), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  ), runtimeEnv("shopify_read_only", {
    BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
    SHOPIFY_APP_PROXY_SECRET: secret,
    SHOPIFY_APP_PROXY_SHOP: shop,
  }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found", expected_mode: "shopify_read_only" });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("enforces in-memory quota before outbound access and returns retry metadata", async (context) => {
  const fetchMock = sequenceFetch(context, [jsonResponse(statusFixture())]);
  const env = runtimeEnv("synthetic_local_sandbox", { BFF_QUOTA_LIMIT: "1", BFF_QUOTA_WINDOW_SECONDS: "60" });
  assert.equal((await localCall("/api/runtime/status", {}, env)).status, 200);
  const limited = await localCall("/api/runtime/status", {}, env);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  assert.equal((await limited.json()).error, "quota_exceeded");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("quota survives fresh Worker env wrappers with the same operator configuration", async (context) => {
  const fetchMock = sequenceFetch(context, [jsonResponse(statusFixture())]);
  const shared = {
    AGENT_CORE_SANDBOX_URL: "http://127.0.0.1:18790",
    BFF_QUOTA_LIMIT: "1",
    BFF_QUOTA_WINDOW_SECONDS: "60",
  };
  const firstEnv = runtimeEnv("synthetic_local_sandbox", shared);
  const freshEnvWrapper = runtimeEnv("synthetic_local_sandbox", shared);
  assert.notEqual(firstEnv, freshEnvWrapper);
  assert.equal((await localCall("/api/runtime/status", {}, firstEnv)).status, 200);
  const limited = await localCall("/api/runtime/status", {}, freshEnvWrapper);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, "quota_exceeded");
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("stream-counts runtime request bodies when Content-Length is absent", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("oversized body must not reach upstream");
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(20 * 1024));
      controller.enqueue(new Uint8Array(20 * 1024));
      controller.close();
    },
  });
  const request = new Request("http://127.0.0.1:8788/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  });
  assert.equal(request.headers.get("content-length"), null);
  const response = await worker.fetch(request, runtimeEnv("synthetic_local_sandbox", {
    AGENT_CORE_SANDBOX_URL: "http://127.0.0.1:18791",
  }));
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "request_too_large");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("maps invalid UTF-8 and trimmed runtime configuration to a closed 400 envelope", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("invalid input must not reach upstream");
  });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([0xc3, 0x28]));
      controller.close();
    },
  });
  const response = await worker.fetch(new Request("http://127.0.0.1:8788/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  }), runtimeEnv("synthetic_local_sandbox", {
    BFF_RUNTIME_MODE: " synthetic_local_sandbox ",
    AGENT_CORE_SANDBOX_URL: "http://127.0.0.1:18792",
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "invalid_request",
    expected_mode: "synthetic_local_sandbox",
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("runtime Origin rejection uses the closed public error envelope", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("rejected origin must not reach upstream");
  });
  const response = await localCall("/api/runtime/status", {
    headers: { origin: "https://untrusted.example.invalid" },
  }, runtimeEnv("shopify_read_only", {
    ALLOWED_ORIGINS: "https://trusted.example.invalid",
    AGENT_CORE_SANDBOX_URL: "http://127.0.0.1:18793",
  }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "origin_not_allowed",
    expected_mode: "shopify_read_only",
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects wrong content type, oversized streams, and redirect responses", async (context) => {
  const oversized = JSON.stringify({ value: "x".repeat((256 * 1024) + 1) });
  const redirect = new Response(null, { status: 302, headers: { location: "https://other.example.invalid" } });
  Object.defineProperty(redirect, "redirected", { value: true });
  const redirects = [];
  sequenceFetch(context, [
    new Response("not json", { headers: { "content-type": "text/plain" } }),
    new Response(oversized, { headers: { "content-type": "application/json" } }),
    redirect,
  ], (request) => redirects.push(request.redirect));
  const expected = [
    "invalid_upstream_content_type", "upstream_response_too_large", "upstream_redirect_rejected",
  ];
  for (const code of expected) {
    const response = await localCall("/api/runtime/status", {}, runtimeEnv());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, code);
  }
  assert.deepEqual(redirects, ["manual", "manual", "manual"]);
});

test("rejects invalid UTF-8 in an upstream JSON response", async (context) => {
  sequenceFetch(context, [new Response(Uint8Array.from([0xc3, 0x28]), {
    headers: { "content-type": "application/json" },
  })]);
  const response = await localCall("/api/runtime/status", {}, runtimeEnv("synthetic_local_sandbox", {
    AGENT_CORE_SANDBOX_URL: "http://127.0.0.1:18794",
  }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "invalid_upstream_contract");
});

test("aborts a stalled upstream status request at the configured timeout", async (context) => {
  context.mock.method(globalThis, "fetch", async (_input, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }));
  const response = await localCall("/api/runtime/status", {}, runtimeEnv(
    "synthetic_local_sandbox", { BFF_UPSTREAM_TIMEOUT_MS: "100" },
  ));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error, "upstream_timeout");
});

test("rejects unexpected private fields and configured secrets instead of partially accepting a run", async (context) => {
  const privateField = searchFixture("shopify_read_only");
  privateField.results[0] = { ...privateField.results[0], supplier_token: "supplier-private-value" };
  const credentialEcho = searchFixture("shopify_read_only");
  credentialEcho.results[0] = { ...credentialEcho.results[0], description: `unsafe ${FAKE_TOKEN}` };
  sequenceFetch(context, [
    jsonResponse(statusFixture("shopify_read_only")), jsonResponse(privateField),
    jsonResponse(statusFixture("shopify_read_only")), jsonResponse(credentialEcho),
  ]);
  for (let index = 0; index < 2; index += 1) {
    const response = await localCall("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "desk organizer" }),
    }, runtimeEnv("shopify_read_only"));
    assert.equal(response.status, 502);
    const text = await response.text();
    assert.equal(JSON.parse(text).error, "invalid_upstream_contract");
    assert.equal(text.includes(FAKE_TOKEN), false);
  }
});

test("runtime search rejects noncanonical S1 facts instead of silently rewriting them", async (context) => {
  const variants = [
    (search) => { search.status = "RESULTS"; },
    (search) => { search.missing_criteria = [" Budget"]; },
    (search) => { search.relaxations = [{ condition: "material", reason: "x".repeat(301) }]; },
    (search) => { search.search_scope.degraded_reason = 42; },
    (search) => {
      search.relaxations = [{ condition: "material", reason: "broadened", from: { private: true } }];
    },
  ];
  const responses = variants.flatMap((mutate) => {
    const search = searchFixture();
    mutate(search);
    return [jsonResponse(statusFixture()), jsonResponse(search)];
  });
  sequenceFetch(context, responses);
  for (const _variant of variants) {
    const response = await localCall("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "desk organizer" }),
    }, runtimeEnv());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "invalid_upstream_contract");
  }
});

test("all public BFF responses, including health, errors, and OPTIONS, are no-store", async () => {
  const env = runtimeEnv();
  const responses = [
    await localCall("/health", {}, env),
    await localCall("/missing", {}, env),
    await localCall("/api/runtime/status?mode=live", {}, env),
    await localCall("/api/runtime/status", { method: "OPTIONS" }, env),
  ];
  for (const response of responses) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
  }
});


test("Shopify App Proxy preserves method and body for status, doctor, and read-only runs", async (context) => {
  const secret = "visibly_fake_shopify_app_proxy_secret";
  const shop = "reference-sandbox.myshopify.com";
  const upstreamRequests = [];
  sequenceFetch(context, [
    jsonResponse(statusFixture("shopify_read_only")),
    jsonResponse(statusFixture("shopify_read_only")),
    jsonResponse(statusFixture("shopify_read_only")),
    jsonResponse(searchFixture("shopify_read_only")),
  ], (request) => upstreamRequests.push(request));
  const env = runtimeEnv("shopify_read_only", {
    BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
    SHOPIFY_APP_PROXY_SECRET: secret,
    SHOPIFY_APP_PROXY_SHOP: shop,
  });
  for (const [path, method, expectedContract] of [
    ["/api/runtime/status", "GET", "reference-store-runtime-status/v1"],
    ["/api/runtime/doctor", "GET", "reference-store-runtime-doctor/v1"],
    ["/api/runs", "POST", "reference-store-read-run/v1"],
  ]) {
    const response = await worker.fetch(new Request(signedProxyUrl(path, secret, shop,
      Math.floor(Date.now() / 1_000), {
        path_prefix: "/apps/reference-store",
        logged_in_customer_id: "",
      }), {
      method,
      headers: { origin: STOREFRONT, "content-type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ query: "desk organizer" }) } : {}),
    }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    const payload = await response.json();
    assert.equal(payload.contract, expectedContract);
    const runtime = payload.runtime || payload;
    assert.equal(runtime.mode, "shopify_read_only");
    assert.equal(runtime.connected, true);
    assert.equal(runtime.capabilities.catalog_search, true);
    assert.equal(runtime.boundaries.commerce_writes, false);
    assert.equal(JSON.stringify(payload).includes(secret), false);
    assert.equal(JSON.stringify(payload).includes(FAKE_TOKEN), false);
  }
  assert.deepEqual(upstreamRequests.map((request) => [request.method, new URL(request.url).pathname]), [
    ["GET", "/sandbox/status"], ["GET", "/sandbox/status"],
    ["GET", "/sandbox/status"], ["POST", "/sandbox/api/search/v2"],
  ]);
  for (const request of upstreamRequests) {
    assert.equal(new URL(request.url).search, "");
    assert.equal(request.headers.get("authorization"), "Bearer " + FAKE_TOKEN);
    assert.equal(request.headers.get("origin"), null);
    assert.equal(request.headers.get("cookie"), null);
  }
  const searchInput = await upstreamRequests[3].json();
  assert.equal(searchInput.product_identity.value, "desk organizer");
  assert.equal(JSON.stringify(searchInput).includes("logged_in_customer_id"), false);
});

test("App Proxy canonicalizes decoded repeated parameters before sorting complete pairs", async (context) => {
  const secret = "visibly_fake_shopify_app_proxy_secret";
  const shop = "reference-sandbox.myshopify.com";
  const timestamp = Math.floor(Date.now() / 1_000);
  // Independent canonical message follows Shopify's documented full-pair sort.
  // The hyphenated key sorts before the equals sign on its shorter sibling.
  const message = "extra-flag=yesextra=one,two wordslogged_in_customer_id="
    + "path_prefix=/apps/reference-storeshop=" + shop + "timestamp=" + timestamp;
  const signature = createHmac("sha256", secret).update(message).digest("hex");
  const query = "shop=" + shop + "&extra=one&path_prefix=%2Fapps%2Freference-store"
    + "&extra-flag=yes&extra=two+words&logged_in_customer_id=&timestamp=" + timestamp
    + "&signature=" + signature;
  sequenceFetch(context, [jsonResponse(statusFixture())]);
  const response = await worker.fetch(new Request("https://proxy.example.invalid/api/runtime/status?" + query),
    runtimeEnv("synthetic_local_sandbox", {
      BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
      SHOPIFY_APP_PROXY_SECRET: secret,
      SHOPIFY_APP_PROXY_SHOP: shop,
    }));
  assert.equal(response.status, 200);
});

test("Shopify read-only mode cannot reopen any legacy route when deployment configuration is absent", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("live configuration failure must not enter a legacy handler");
  });
  for (const path of ["/api/chat", "/api/search", "/api/catalog"]) {
    const response = await localCall(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: "desk organizer", messages: [{ role: "user", content: "desk organizer" }] }),
    }, runtimeEnv("shopify_read_only", {
      BFF_DEPLOYMENT_MODE: "",
      AGENT_CORE_BASE_URL: "https://agent-core.example.invalid",
      AGENT_CORE_TENANT_KEY: FAKE_TOKEN,
    }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "deployment_not_configured", expected_mode: "shopify_read_only",
    });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("signed Shopify read-only traffic cannot enter any legacy route", async (context) => {
  const secret = "visibly_fake_shopify_app_proxy_secret";
  const shop = "reference-sandbox.myshopify.com";
  const fetchMock = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("disabled legacy route must not reach Agent Core");
  });
  const env = runtimeEnv("shopify_read_only", {
    BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
    SHOPIFY_APP_PROXY_SECRET: secret,
    SHOPIFY_APP_PROXY_SHOP: shop,
    AGENT_CORE_BASE_URL: "https://agent-core.example.invalid",
    AGENT_CORE_TENANT_KEY: FAKE_TOKEN,
  });
  for (const path of ["/api/chat", "/api/search", "/api/catalog"]) {
    const response = await worker.fetch(new Request(signedProxyUrl(path, secret, shop,
      Math.floor(Date.now() / 1_000)), {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }), env);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found", expected_mode: "shopify_read_only" });
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
