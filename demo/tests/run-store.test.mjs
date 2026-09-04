import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunStore,
  freezeReadRun,
  freezeRuntimeStatus,
  validateReadRun,
  validateRuntimeStatus,
} from "../run-store.mjs";

function runtimeFixture({ live = false, connected = true } = {}) {
  const failed = live && !connected;
  return {
    contract: "reference-store-runtime-status/v1",
    source_contract: "shopify-live-sandbox-status/v1",
    mode: live ? "shopify_read_only" : "synthetic_local_sandbox",
    connected,
    credential_state: failed ? "credential_missing" : (live ? "succeeded" : "mock_ready"),
    data_source: live ? "shopify_storefront_graphql" : "synthetic_fixture",
    api_version: live ? "2026-07" : null,
    quota: {
      limit: 120,
      remaining: 119,
      window_seconds: 60,
      concurrency_limit: 8,
      reset_at: "2026-08-31T01:01:00.000Z",
    },
    writes_disabled: true,
    capabilities: {
      doctor: true,
      catalog_search: connected,
      search_contract_v2: connected,
      product_detail: connected,
      storefront_health: live ? connected : false,
    },
    checked_at: "2026-08-31T01:00:00.000Z",
    error_code: failed ? "CREDENTIAL_MISSING" : null,
    boundaries: {
      non_transactional: true,
      purchasable: false,
      shipping_rates: false,
      commerce_writes: false,
      credential_exposed: false,
    },
    components: {
      reference_store: { commit: "1".repeat(40), tree: "2".repeat(40), version: "test" },
      agent_core: { commit: "3".repeat(40), version: "test" },
      storefront_bff: { commit: "1".repeat(40), version: "test" },
    },
    deployment_attestation: {
      contract: "reference-store-deployment-attestation/v1",
      algorithm: "Ed25519",
      key_id: "synthetic-test-key",
      descriptor_sha256: "4".repeat(64),
      signature: "A".repeat(86),
    },
  };
}

function productFixture({ live = false, suffix = "", origin = "https://shop.example.test" } = {}) {
  const handle = `walnut-desk-organizer${suffix}`;
  return {
    public_id: `pub_walnut${suffix.replaceAll("-", "_")}`,
    handle,
    title: "Walnut desk organizer",
    summary: "Compact compartments for a calm workspace.",
    image: "",
    price: { amount: 29, currency: "USD" },
    available_for_sale: live,
    product_url: live ? `${origin}/products/${handle}` : "",
    shopify_verified_at: live ? "2026-08-31T01:00:00.000Z" : null,
    synthetic: !live,
    non_transactional: true,
    purchasable: false,
    writes: false,
    shipping_rates: false,
  };
}

function runFixture({ live = false, products = null } = {}) {
  const results = products || [productFixture({ live })];
  return {
    contract: "reference-store-read-run/v1",
    runtime: runtimeFixture({ live }),
    search: {
      contract_version: "2.0",
      trace_id: "trace.read-only-001",
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
      results,
      pagination: { limit: 10, cursor: null, next_cursor: null, has_more: false },
      search_scope: {
        plan_complete: true,
        scope_exhausted: true,
        global_catalog_exhaustive: false,
        scan_limit_reached: false,
        degraded: false,
        degraded_reason: null,
      },
    },
  };
}

test("runtime validation is exact and enforces closed Synthetic and Shopify states", () => {
  assert.equal(validateRuntimeStatus(runtimeFixture()).mode, "synthetic_local_sandbox");
  assert.equal(validateRuntimeStatus(runtimeFixture({ live: true })).mode, "shopify_read_only");
  assert.equal(validateRuntimeStatus(runtimeFixture({ live: true, connected: false })).connected, false);

  const extra = runtimeFixture();
  extra.raw_provider = { secret: "must never pass" };
  assert.throws(() => validateRuntimeStatus(extra), /invalid_runtime_status/);

  const falseLive = runtimeFixture({ live: true, connected: false });
  falseLive.credential_state = "succeeded";
  falseLive.error_code = null;
  assert.throws(() => validateRuntimeStatus(falseLive), /invalid_runtime_status/);

  const malformedTime = runtimeFixture();
  malformedTime.checked_at = "2026-08-31 01:00:00";
  assert.throws(() => freezeRuntimeStatus(malformedTime), /invalid_runtime_status/);
});

test("one parsed run is recursively frozen and sent by identity to every renderer", () => {
  const run = runFixture({ live: true });
  const received = [];
  let receiptText = "";
  const store = createRunStore({
    renderWorkbench(value) { received.push(value); },
    renderDrawer(value) { received.push(value); },
    renderReceipt(value) {
      received.push(value);
      receiptText = JSON.stringify(value);
    },
  });

  const active = store.setActiveRun(run);
  assert.equal(active, run, "the parsed BFF object itself must become activeRun");
  assert.equal(store.getActiveRun(), run);
  assert.ok(received.every((value) => value === run));
  assert.deepEqual(store.getLastRenderIdentity(), {
    workbench: true,
    drawer: true,
    receipt: true,
    all: true,
  });
  assert.equal(Object.isFrozen(run), true);
  assert.equal(Object.isFrozen(run.runtime), true);
  assert.equal(Object.isFrozen(run.search.results), true);
  assert.equal(Object.isFrozen(run.search.results[0].price), true);
  assert.deepEqual(JSON.parse(receiptText), run, "receipt content must equal the accepted response exactly");
  assert.throws(() => { run.search.results[0].title = "Browser reconstruction"; }, TypeError);
});

test("a second accepted run replaces the first active run in every projection", () => {
  const received = { workbench: [], drawer: [], receipt: [] };
  const store = createRunStore({
    renderWorkbench(value) { received.workbench.push(value); },
    renderDrawer(value) { received.drawer.push(value); },
    renderReceipt(value) { received.receipt.push(value); },
  });
  const first = runFixture();
  const second = runFixture({
    products: [productFixture({ suffix: "-second" })],
  });

  store.setActiveRun(first);
  store.setActiveRun(second);

  assert.equal(store.getActiveRun(), second);
  for (const projection of Object.values(received)) {
    assert.equal(projection.length, 2);
    assert.equal(projection[0], first);
    assert.equal(projection[1], second);
  }
  assert.equal(store.getLastRenderIdentity().all, true);
});

test("read runs reject malicious product URLs and cross-store result sets", () => {
  for (const productUrl of [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "https://user:pass@shop.example.test/products/walnut-desk-organizer",
    "https://127.0.0.1/products/walnut-desk-organizer",
    "https://10.0.0.1/products/walnut-desk-organizer",
    "https://shop.local/products/walnut-desk-organizer",
    "http://shop.example.test/products/walnut-desk-organizer",
    "https://shop.example.test/products/another-handle",
    "https://shop.example.test/products/walnut-desk-organizer?variant=1",
  ]) {
    const run = runFixture({ live: true });
    run.search.results[0].product_url = productUrl;
    assert.throws(() => validateReadRun(run), /invalid_read_run/, productUrl);
  }

  const crossStore = runFixture({
    live: true,
    products: [
      productFixture({ live: true }),
      productFixture({ live: true, suffix: "-two", origin: "https://other.example.test" }),
    ],
  });
  assert.throws(() => validateReadRun(crossStore), /invalid_read_run/);
});

test("runs reject unknown fields, synthetic Shopify claims, and closed runtimes", () => {
  const unknown = runFixture();
  unknown.search.results[0].available = true;
  assert.throws(() => freezeReadRun(unknown), /invalid_read_run/);

  const syntheticClaim = runFixture();
  syntheticClaim.search.results[0].product_url = "https://shop.example.test/products/walnut-desk-organizer";
  assert.throws(() => validateReadRun(syntheticClaim), /invalid_read_run/);

  const closed = runFixture({ live: true });
  closed.runtime = runtimeFixture({ live: true, connected: false });
  assert.throws(() => validateReadRun(closed), /invalid_read_run/);
});
