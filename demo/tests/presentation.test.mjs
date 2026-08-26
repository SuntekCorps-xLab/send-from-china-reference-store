import assert from "node:assert/strict";
import test from "node:test";

import {
  formatIllustrativePrice,
  runtimePresentation,
  sanitizeErrorCode,
  sanitizeHttpStatus,
  sanitizeOptionalInspectorFields,
} from "../public-contract.mjs";

test("formats only finite positive prices with an ISO-like currency as illustrative", () => {
  assert.equal(formatIllustrativePrice({ price: 29, currency: "usd" }), "Illustrative USD 29.00");
  assert.equal(formatIllustrativePrice({ price: "29", currency: "USD" }), "No price claim");
  assert.equal(formatIllustrativePrice({ price: 0, currency: "USD" }), "No price claim");
  assert.equal(formatIllustrativePrice({ price: 29, currency: "US" }), "No price claim");
  assert.equal(formatIllustrativePrice({ price: Number.NaN, currency: "USD" }), "No price claim");
});

test("runtime presentation distinguishes verified, unavailable, and malformed connected states", () => {
  const simulated = runtimePresentation({
    mode: "synthetic_demo",
    data_source: "offline_fixtures",
    live_agent_core: false,
    synthetic: true,
  });
  assert.equal(simulated.runtimeLabel, "Simulated demo · zero-account fixtures");

  const ready = runtimePresentation({
    mode: "connected_local_sandbox",
    configured: true,
    reachable: true,
    sandbox_identity_verified: true,
    auth_verified: true,
    verified: true,
    live_agent_core: true,
    readiness: "ready",
  });
  assert.equal(ready.verified, true);
  assert.match(ready.runtimeLabel, /Connected local sandbox/);

  const unavailable = runtimePresentation({
    mode: "connected_local_sandbox",
    configured: true,
    reachable: false,
    sandbox_identity_verified: false,
    auth_verified: false,
    verified: false,
    live_agent_core: false,
    readiness: "unavailable",
  });
  assert.equal(unavailable.verified, false);
  assert.equal(unavailable.bannerMode, "connected_unavailable");
  assert.match(unavailable.runtimeLabel, /unavailable/);

  assert.throws(() => runtimePresentation({ mode: "unexpected_mode" }), /invalid_runtime_status/);
  assert.throws(() => runtimePresentation({
    mode: "connected_local_sandbox",
    configured: true,
    reachable: false,
    sandbox_identity_verified: false,
    auth_verified: false,
    verified: false,
    live_agent_core: true,
    readiness: "unavailable",
  }), /invalid_runtime_status/);
});

test("the inspector retains only generic error codes and valid HTTP statuses", () => {
  assert.equal(sanitizeErrorCode("sandbox_not_ready"), "sandbox_not_ready");
  assert.equal(sanitizeErrorCode({ code: "UPSTREAM_UNAVAILABLE" }), "upstream_unavailable");
  assert.equal(sanitizeErrorCode("token=private detail"), "");
  assert.equal(sanitizeErrorCode({ private_detail: "do not return" }), "");
  assert.equal(sanitizeHttpStatus(503), 503);
  assert.equal(sanitizeHttpStatus("429"), 429);
  assert.equal(sanitizeHttpStatus(99), null);
  assert.equal(sanitizeHttpStatus("not-a-status"), null);
});

test("the inspector omits absent optional metadata instead of inventing unknown states", () => {
  assert.deepEqual(sanitizeOptionalInspectorFields({}, undefined, ["catalog_match"]), {});
  assert.deepEqual(sanitizeOptionalInspectorFields({ error: "", scenario: null, status: "" }, 200, ["catalog_match"]), {
    http_status: 200,
  });
  assert.deepEqual(sanitizeOptionalInspectorFields({
    error: "sandbox_not_ready",
    scenario: "catalog_match",
    status: "no_match",
  }, 503, ["catalog_match"]), {
    http_status: 503,
    error: "sandbox_not_ready",
    scenario: "catalog_match",
    status: "no_match",
  });
});
