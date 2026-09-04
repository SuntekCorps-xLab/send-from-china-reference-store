import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bffEndpointUrl,
  formatIllustrativePrice,
  formatVerifiedPrice,
  runtimePresentation,
  sanitizeErrorCode,
  sanitizeHttpStatus,
  sanitizeOptionalInspectorFields,
  sanitizePublicErrorCode,
} from "../public-contract.mjs";

test("BFF endpoints stay same-origin and retain a Shopify App Proxy prefix", () => {
  assert.equal(
    bffEndpointUrl({ origin: "http://127.0.0.1:4173", pathname: "/" }, "runtime/status"),
    "http://127.0.0.1:4173/api/runtime/status",
  );
  assert.equal(
    bffEndpointUrl({ origin: "https://reference.myshopify.com", pathname: "/apps/reference" }, "runs"),
    "https://reference.myshopify.com/apps/reference/api/runs",
  );
  assert.equal(
    bffEndpointUrl({ origin: "https://reference.myshopify.com", pathname: "/apps/reference/" }, "runtime/status"),
    "https://reference.myshopify.com/apps/reference/api/runtime/status",
  );
  assert.equal(bffEndpointUrl({ origin: "https://reference.myshopify.com", pathname: "//evil.test" }, "runs"), "");
  assert.equal(bffEndpointUrl({ origin: "https://reference.myshopify.com", pathname: "/" }, "mode/live"), "");
});

function runtimeFixture(overrides = {}) {
  return {
    contract: "reference-store-runtime-status/v1",
    source_contract: "shopify-live-sandbox-status/v1",
    mode: "synthetic_local_sandbox",
    connected: true,
    credential_state: "mock_ready",
    data_source: "synthetic_fixture",
    api_version: null,
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
      catalog_search: true,
      search_contract_v2: true,
      product_detail: true,
      storefront_health: false,
    },
    checked_at: "2026-08-31T01:00:00.000Z",
    error_code: null,
    boundaries: {
      non_transactional: true,
      purchasable: false,
      shipping_rates: false,
      commerce_writes: false,
      credential_exposed: false,
    },
    ...overrides,
  };
}

test("price copy distinguishes illustrative and Shopify-verified facts", () => {
  assert.equal(formatIllustrativePrice({ price: { amount: 29, currency: "USD" } }), "Illustrative USD 29.00");
  assert.equal(formatIllustrativePrice({ price: { amount: "29", currency: "USD" } }), "No illustrative price claim");
  assert.equal(formatVerifiedPrice({ price: { amount: 29, currency: "USD" } }), "Shopify verified USD 29.00");
  assert.equal(formatVerifiedPrice({ price: { amount: 29, currency: "US" } }), "No Shopify price claim");
});

test("runtime presentation keeps Synthetic and Shopify read-only failure visibly distinct", () => {
  const synthetic = runtimePresentation(runtimeFixture());
  assert.equal(synthetic.modeLabel, "Synthetic");
  assert.match(synthetic.connectionLabel, /offline fixtures/);
  assert.equal(synthetic.writesLabel, "Writes disabled");

  const live = runtimePresentation(runtimeFixture({
    mode: "shopify_read_only",
    connected: true,
    credential_state: "succeeded",
    data_source: "shopify_storefront_graphql",
    api_version: "2026-07",
    capabilities: {
      doctor: true,
      catalog_search: true,
      search_contract_v2: true,
      product_detail: true,
      storefront_health: true,
    },
  }));
  assert.equal(live.modeLabel, "Shopify read-only");
  assert.match(live.connectionLabel, /Shopify verified/);

  const missing = runtimePresentation(runtimeFixture({
    mode: "shopify_read_only",
    connected: false,
    credential_state: "credential_missing",
    data_source: "shopify_storefront_graphql",
    api_version: "2026-07",
    error_code: "CREDENTIAL_MISSING",
    capabilities: {
      doctor: true,
      catalog_search: false,
      search_contract_v2: false,
      product_detail: false,
      storefront_health: false,
    },
  }));
  assert.equal(missing.modeLabel, "Shopify read-only");
  assert.equal(missing.connected, false);
  assert.match(missing.connectionLabel, /credentials missing/);
  assert.doesNotMatch(missing.runtimeLabel, /Synthetic/);
});

test("only the public error enumeration reaches presentation copy", () => {
  assert.equal(sanitizePublicErrorCode("quota_exceeded"), "quota_exceeded");
  assert.equal(sanitizePublicErrorCode("private upstream detail"), "service_unavailable");
  assert.equal(sanitizeErrorCode({ code: "UPSTREAM_TIMEOUT" }), "upstream_timeout");
  assert.equal(sanitizeErrorCode({ private_detail: "do not return" }), "");
  assert.equal(sanitizeHttpStatus("429"), 429);
  assert.equal(sanitizeHttpStatus(99), null);
  assert.deepEqual(sanitizeOptionalInspectorFields({ error: "quota_exceeded" }, 429), {
    http_status: 429,
    error: "quota_exceeded",
  });
});

test("the page exposes stable QA hooks and no browser credential, persistence, or telemetry path", async () => {
  const [html, script, css] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../demo.js", import.meta.url), "utf8"),
    readFile(new URL("../demo.css", import.meta.url), "utf8"),
  ]);
  for (const hook of [
    "data-run-form",
    "data-run-button",
    "data-workbench-results",
    "data-drawer-results",
    "data-runs-receipt",
    "data-runtime-ready",
  ]) assert.match(html, new RegExp(hook));
  assert.match(script, /fetch\(runtimeStatusEndpoint/u);
  assert.match(script, /fetch\(runEndpoint/u);
  assert.doesNotMatch(script, /fetch\("\/api\//u);
  assert.ok((script.match(/credentials: "omit"/gu) || []).length >= 2);
  assert.ok((script.match(/cache: "no-store"/gu) || []).length >= 2);
  assert.match(script, /Open verified Shopify product/u);
  assert.doesNotMatch(script, /localStorage|sessionStorage|document\.cookie|sendBeacon|telemetry/iu);
  assert.doesNotMatch(html, /<input[^>]+(?:token|secret|credential)/iu);
  assert.match(html, /Settings \/ Connections/u);
  assert.match(html, /data-connected-activation/u);
  assert.match(html, /npm run demo:platform/u);
  assert.match(html, /runtime is selected server-side/iu);
  assert.match(html, /Writes disabled/u);
  assert.match(html, /Synthetic behavior is deterministic/u);
  assert.match(html, /keyword routing[^<]*not AI inference/u);
  assert.match(css, /prefers-reduced-motion[\s\S]*transition-duration:\s*\.01ms/iu);
});
