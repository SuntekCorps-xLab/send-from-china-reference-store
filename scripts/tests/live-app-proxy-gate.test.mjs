import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  executeLiveGate,
  LiveGateError,
  loadLiveGateConfig,
  observeBrowserRequest,
  validateCases,
  validateDoctorContract,
  validateManifestShape,
  validatePreviewIdentity,
  validateReceiptShape,
  validateRunContract,
  validateRuntimeContract,
  writeEvidence,
} from "../live-app-proxy-gate.mjs";

const REFERENCE_COMMIT = "1".repeat(40);
const REFERENCE_TREE = "2".repeat(40);
const CORE_COMMIT = "3".repeat(40);
const SHOP = "reference-gate.myshopify.com";
const THEME = "123456789012";
const CHECKED_AT = "2026-09-04T00:00:00.000Z";
const COMPONENTS = Object.freeze({
  reference_store: Object.freeze({ commit: REFERENCE_COMMIT, tree: REFERENCE_TREE, version: "1.1.0" }),
  agent_core: Object.freeze({ commit: CORE_COMMIT, version: "1.2.0" }),
  storefront_bff: Object.freeze({ commit: REFERENCE_COMMIT, version: "1.1.0" }),
});
const SIGNING_KEY_ID = "release-gate-test-key";
const { publicKey: DEPLOYMENT_PUBLIC_KEY, privateKey: DEPLOYMENT_PRIVATE_KEY } = generateKeyPairSync("ed25519");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deploymentAttestation(components, privateKey = DEPLOYMENT_PRIVATE_KEY) {
  const descriptor = { components, schema_version: "reference-store-deployment-descriptor/v1" };
  const raw = canonicalJson(descriptor);
  return {
    contract: "reference-store-deployment-attestation/v1",
    algorithm: "Ed25519",
    key_id: SIGNING_KEY_ID,
    descriptor_sha256: sha256(raw),
    signature: sign(null, Buffer.from(raw), privateKey).toString("base64url"),
  };
}

function caseManifest() {
  return {
    schema_version: "reference-store-live-app-proxy-cases/v1",
    cases: Array.from({ length: 10 }, (_, index) => ({
      case_id: `case_${(index + 1).toString(16).padStart(16, "0")}`,
      query: `private known query ${index + 1}`,
      expected_handle: `expected-product-${index + 1}`,
    })),
  };
}

function runtime(overrides = {}) {
  const components = overrides.components || COMPONENTS;
  return {
    contract: "reference-store-runtime-status/v1",
    source_contract: "shopify-live-sandbox-status/v1",
    mode: "shopify_read_only",
    connected: true,
    credential_state: "succeeded",
    data_source: "shopify_storefront_graphql",
    api_version: "2026-07",
    quota: { limit: 100, remaining: 90, window_seconds: 60, concurrency_limit: 4, reset_at: CHECKED_AT },
    writes_disabled: true,
    capabilities: {
      doctor: true,
      catalog_search: true,
      search_contract_v2: true,
      product_detail: true,
      storefront_health: true,
    },
    checked_at: CHECKED_AT,
    error_code: null,
    boundaries: {
      non_transactional: true,
      purchasable: false,
      shipping_rates: false,
      commerce_writes: false,
      credential_exposed: false,
    },
    components,
    deployment_attestation: deploymentAttestation(components),
    ...overrides,
  };
}

function searchFor(handle) {
  return {
    contract_version: "2.0",
    trace_id: `trace-${handle}`,
    status: "results",
    normalized_intent: {
      product_identity: {
        name: "product_identity", value: "known product", source: "explicit", scope: "product", hardness: "hard",
      },
      hard_constraints: [],
      soft_context: [],
      transaction_context: [],
    },
    relaxations: [],
    missing_criteria: [],
    results: [{
      public_id: `public_${handle.replaceAll("-", "_")}`,
      handle,
      title: "Known product",
      summary: "Published product.",
      image: "https://cdn.shopify.com/product.jpg",
      price: { amount: 20, currency: "USD" },
      available_for_sale: true,
      product_url: `https://${SHOP}/products/${handle}`,
      shopify_verified_at: CHECKED_AT,
      synthetic: false,
      non_transactional: true,
      purchasable: false,
      writes: false,
      shipping_rates: false,
    }],
    pagination: { limit: 20, cursor: null, next_cursor: null, has_more: false },
    search_scope: {
      plan_complete: true,
      scope_exhausted: true,
      global_catalog_exhaustive: false,
      scan_limit_reached: false,
      degraded: false,
      degraded_reason: null,
    },
  };
}

function safeCounts(overrides = {}) {
  return {
    cross_origin_api_requests: 0,
    legacy_route_requests: 0,
    unexpected_api_requests: 0,
    browser_write_requests: 0,
    forbidden_browser_header_requests: 0,
    browser_storage_credential_hits: 0,
    browser_storage_query_hits: 0,
    browser_persistent_storage_hits: 0,
    console_errors: 0,
    page_errors: 0,
    ...overrides,
  };
}

function transportFor(cases, overrides = {}) {
  const handles = new Map(cases.map((item) => [item.query, item.expected_handle]));
  return {
    status: async () => runtime(),
    doctor: async () => ({
      contract: "reference-store-runtime-doctor/v1",
      ok: true,
      runtime: runtime(),
      checks: {
        deployment_mode: true, agent_core_status: true, expected_mode: true,
        credential_isolated: true, writes_disabled: true,
      },
    }),
    run: async (query) => ({
      contract: "reference-store-read-run/v1",
      runtime: runtime(),
      search: searchFor(handles.get(query)),
    }),
    safety: async () => safeCounts(),
    close: async () => {},
    ...overrides,
  };
}

function directConfig(overrides = {}) {
  const cases = validateCases(caseManifest());
  return {
    preview: { shopDomain: SHOP, origin: `https://${SHOP}`, themeId: THEME },
    browser: "chromium",
    cases,
    casesSha256: "4".repeat(64),
    components: COMPONENTS,
    deploymentSigner: {
      keyId: SIGNING_KEY_ID,
      publicKey: DEPLOYMENT_PUBLIC_KEY,
      publicKeySha256: sha256(DEPLOYMENT_PUBLIC_KEY.export({ type: "spki", format: "der" })),
    },
    ...overrides,
  };
}

async function withSandbox(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "reference-live-gate-"));
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function configFixture(root, environmentOverrides = {}, options = {}) {
  const repositoryRoot = path.join(root, "repo");
  const privateRoot = path.join(root, "private");
  const casesPath = path.join(privateRoot, "cases.json");
  const publicKeyPath = path.join(privateRoot, "deployment-public-key.pem");
  const outputRoot = path.join(privateRoot, "evidence");
  await mkdir(repositoryRoot);
  await mkdir(privateRoot);
  await writeFile(path.join(repositoryRoot, "package.json"), '{"version":"1.1.0"}\n');
  const manifest = options.manifest || caseManifest();
  await writeFile(casesPath, `${JSON.stringify(manifest)}\n`);
  await writeFile(publicKeyPath, DEPLOYMENT_PUBLIC_KEY.export({ type: "spki", format: "pem" }));
  const environment = {
    REFERENCE_STORE_LIVE_GATE_CONFIRM: "READ_ONLY_APP_PROXY_10",
    REFERENCE_STORE_LIVE_BROWSER: "chromium",
    REFERENCE_STORE_LIVE_PREVIEW_URL: `https://${SHOP}/?preview_theme_id=${THEME}&_fd=0&pb=0`,
    REFERENCE_STORE_EXPECTED_SHOP_DOMAIN: SHOP,
    REFERENCE_STORE_EXPECTED_THEME_ID: THEME,
    REFERENCE_STORE_LIVE_CASES_PATH: casesPath,
    REFERENCE_STORE_DEPLOYMENT_PUBLIC_KEY_PATH: publicKeyPath,
    REFERENCE_STORE_DEPLOYMENT_PUBLIC_KEY_SHA256: sha256(
      DEPLOYMENT_PUBLIC_KEY.export({ type: "spki", format: "der" }),
    ),
    REFERENCE_STORE_DEPLOYMENT_SIGNING_KEY_ID: SIGNING_KEY_ID,
    REFERENCE_STORE_LIVE_EVIDENCE_ROOT: outputRoot,
    REFERENCE_STORE_EXPECTED_REFERENCE_COMMIT: REFERENCE_COMMIT,
    REFERENCE_STORE_EXPECTED_REFERENCE_TREE: REFERENCE_TREE,
    REFERENCE_STORE_EXPECTED_REFERENCE_VERSION: "1.1.0",
    REFERENCE_STORE_EXPECTED_BFF_COMMIT: REFERENCE_COMMIT,
    REFERENCE_STORE_EXPECTED_BFF_VERSION: "1.1.0",
    REFERENCE_STORE_EXPECTED_CORE_COMMIT: CORE_COMMIT,
    REFERENCE_STORE_EXPECTED_CORE_VERSION: "1.2.0",
    ...environmentOverrides,
  };
  return {
    repositoryRoot,
    outputRoot,
    environment,
    repositoryIdentity: { commit: REFERENCE_COMMIT, tree: REFERENCE_TREE, dirty: false },
  };
}

test("requires Node 22 and explicit read-only live confirmation before loading inputs", async () => {
  await assert.rejects(() => loadLiveGateConfig({ environment: {}, nodeVersion: "24.1.0" }),
    (error) => error instanceof LiveGateError && error.code === "node_22_required");
  await assert.rejects(() => loadLiveGateConfig({ environment: {}, nodeVersion: "22.23.2" }),
    (error) => error instanceof LiveGateError && error.code === "live_gate_not_confirmed");
});

test("CLI defaults to a closed non-network run", () => {
  const script = fileURLToPath(new URL("../live-app-proxy-gate.mjs", import.meta.url));
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("REFERENCE_STORE_LIVE_") || name.startsWith("REFERENCE_STORE_EXPECTED_")) {
      delete environment[name];
    }
  }
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: environment });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "FAIL: live_gate_not_confirmed\n");
});

test("accepts only an exact HTTPS permanent shop and unpublished theme identity", () => {
  assert.equal(validatePreviewIdentity({
    previewUrl: `https://${SHOP}/?preview_theme_id=${THEME}`,
    shopDomain: SHOP,
    themeId: THEME,
  }).origin, `https://${SHOP}`);
  for (const previewUrl of [
    `http://${SHOP}/?preview_theme_id=${THEME}`,
    `https://other.myshopify.com/?preview_theme_id=${THEME}`,
    `https://${SHOP}/?preview_theme_id=999999999999`,
    `https://${SHOP}/?preview_theme_id=${THEME}&signature=secret`,
  ]) {
    assert.throws(() => validatePreviewIdentity({ previewUrl, shopDomain: SHOP, themeId: THEME }), LiveGateError);
  }
});

test("case contract requires exactly ten unique, closed, sanitized known cases", () => {
  assert.equal(validateCases(caseManifest()).length, 10);
  const short = caseManifest();
  short.cases.pop();
  assert.throws(() => validateCases(short), LiveGateError);
  const duplicate = caseManifest();
  duplicate.cases[9].case_id = duplicate.cases[0].case_id;
  assert.throws(() => validateCases(duplicate), LiveGateError);
  const unknown = caseManifest();
  unknown.cases[0].extra = true;
  assert.throws(() => validateCases(unknown), LiveGateError);
  const control = caseManifest();
  control.cases[0].query = "desk\norganizer";
  assert.throws(() => validateCases(control), LiveGateError);
  const disclosed = caseManifest();
  disclosed.cases[0].query = disclosed.cases[0].case_id;
  assert.throws(() => validateCases(disclosed), LiveGateError);
  const crossCaseDisclosed = caseManifest();
  crossCaseDisclosed.cases[0].query = crossCaseDisclosed.cases[1].case_id;
  assert.throws(() => validateCases(crossCaseDisclosed), LiveGateError);
  const duplicateQuery = caseManifest();
  duplicateQuery.cases[9].query = `  ${duplicateQuery.cases[0].query.toUpperCase()}  `.trim();
  assert.throws(() => validateCases(duplicateQuery), LiveGateError);
  const invisibleDuplicate = caseManifest();
  invisibleDuplicate.cases[9].query = `${invisibleDuplicate.cases[0].query}\u200b`;
  assert.throws(() => validateCases(invisibleDuplicate), LiveGateError);
  const duplicateHandle = caseManifest();
  duplicateHandle.cases[9].expected_handle = duplicateHandle.cases[0].expected_handle;
  assert.throws(() => validateCases(duplicateHandle), LiveGateError);
  const descriptiveId = caseManifest();
  descriptiveId.cases[0].case_id = "private_known_query";
  assert.throws(() => validateCases(descriptiveId), LiveGateError);
});

test("config seals external inputs, repository identity, versions and process secret absence", async () => {
  await withSandbox(async (root) => {
    const fixture = await configFixture(root);
    const config = await loadLiveGateConfig({ ...fixture, nodeVersion: "22.23.2" });
    assert.equal(config.cases.length, 10);
    assert.equal(config.components.storefront_bff.commit, REFERENCE_COMMIT);
    await assert.rejects(() => loadLiveGateConfig({
      ...fixture,
      environment: { ...fixture.environment, SHOPIFY_APP_PROXY_SECRET: "must-not-enter-browser-harness" },
      nodeVersion: "22.23.2",
    }), (error) => error.code === "browser_harness_secret_present");
    for (const name of [
      "shopify_app_proxy_secret",
      "agent_core_runtime_credential",
      "SHOPIFY_SERVICE_PASSWORD",
      "SHOPIFY_TOKEN_BACKUP",
      "SHOPIFY_API_KEY_V2",
      "AGENT_CORE_SECRET_JSON",
      "AGENT_CORE_PASSWORD_FILE",
    ]) {
      await assert.rejects(() => loadLiveGateConfig({
        ...fixture,
        environment: { ...fixture.environment, [name]: "must-not-enter-browser-harness" },
        nodeVersion: "22.23.2",
      }), (error) => error.code === "browser_harness_secret_present");
    }
    await assert.rejects(() => loadLiveGateConfig({
      ...fixture,
      environment: { ...fixture.environment, REFERENCE_STORE_EXPECTED_BFF_COMMIT: CORE_COMMIT },
      nodeVersion: "22.23.2",
    }), (error) => error.code === "bff_commit_mismatch");
    await assert.rejects(() => loadLiveGateConfig({
      ...fixture,
      environment: { ...fixture.environment, REFERENCE_STORE_DEPLOYMENT_PUBLIC_KEY_SHA256: "0".repeat(64) },
      nodeVersion: "22.23.2",
    }), (error) => error.code === "deployment_public_key_identity_mismatch");
  });
});

test("injected 10/10 proves receipt logic without claiming a browser or network run", async () => {
  const config = directConfig();
  let tick = 1000;
  const receipt = await executeLiveGate({
    config,
    transport: transportFor(config.cases),
    now: () => { tick += 7; return tick; },
  });
  assert.equal(receipt.gate_status, "passed");
  assert.deepEqual(receipt.expected_components, COMPONENTS);
  assert.deepEqual(receipt.observed_components, COMPONENTS);
  assert.equal(receipt.journeys.length, 10);
  assert.equal(receipt.execution.passed_count, 10);
  assert.equal(receipt.boundaries.actual_shopify_app_proxy_verified, true);
  assert.deepEqual(receipt.safety, safeCounts());
  const serialized = JSON.stringify(receipt);
  for (const item of config.cases) {
    assert.equal(serialized.includes(item.query), false);
    assert.equal(serialized.includes(item.expected_handle), false);
  }
  assert.equal(serialized.includes(SHOP), false);
});

test("wrong-but-well-formed deployed component identity fails closed and remains distinct from expected", async () => {
  const config = directConfig();
  const wrong = {
    ...COMPONENTS,
    agent_core: { commit: "9".repeat(40), version: COMPONENTS.agent_core.version },
  };
  const receipt = await executeLiveGate({
    config,
    transport: transportFor(config.cases, { status: async () => runtime({ components: wrong }) }),
  });
  assert.equal(receipt.gate_status, "failed");
  assert.equal(receipt.execution.failure_code, "deployed_component_identity_mismatch");
  assert.deepEqual(receipt.expected_components, COMPONENTS);
  assert.deepEqual(receipt.observed_components, wrong);
  assert.equal(receipt.boundaries.actual_shopify_app_proxy_verified, false);
});

test("self-attested component labels cannot pass without the independently pinned deployment signer", async () => {
  const config = directConfig();
  const untrusted = generateKeyPairSync("ed25519");
  const receipt = await executeLiveGate({
    config,
    transport: transportFor(config.cases, {
      status: async () => runtime({
        deployment_attestation: deploymentAttestation(COMPONENTS, untrusted.privateKey),
      }),
    }),
  });
  assert.equal(receipt.gate_status, "failed");
  assert.equal(receipt.execution.failure_code, "deployment_attestation_invalid");
  assert.equal(receipt.deployment_attestation.verified, false);
  assert.equal(receipt.boundaries.actual_shopify_app_proxy_verified, false);
});

test("runtime, doctor and run contracts recursively reject unknown fields and identity drift", () => {
  assert.doesNotThrow(() => validateRuntimeContract(runtime()));
  assert.throws(() => validateRuntimeContract({ ...runtime(), private_cost: 1 }),
    (error) => error.code === "invalid_live_runtime_contract");
  const doctor = {
    contract: "reference-store-runtime-doctor/v1", ok: true, runtime: runtime(),
    checks: {
      deployment_mode: true, agent_core_status: true, expected_mode: true,
      credential_isolated: true, writes_disabled: true,
    },
  };
  assert.equal(validateDoctorContract(doctor, runtime()), doctor);
  assert.throws(() => validateDoctorContract({ ...doctor, checks: { ...doctor.checks, extra: true } }, runtime()),
    (error) => error.code === "live_doctor_failed");
  const run = { contract: "reference-store-read-run/v1", runtime: runtime(), search: searchFor("known-product") };
  assert.equal(validateRunContract(run, "known-product", `https://${SHOP}`, runtime()), 1);
  assert.throws(() => validateRunContract({
    ...run, search: { ...run.search, internal_url: "https://internal.invalid" },
  }, "known-product", `https://${SHOP}`, runtime()), (error) => error.code === "invalid_live_run_contract");
  assert.throws(() => validateRunContract({
    ...run, runtime: runtime({ components: {
      ...COMPONENTS, agent_core: { commit: "8".repeat(40), version: "1.2.0" },
    } }),
  }, "known-product", `https://${SHOP}`, runtime()), (error) => error.code === "runtime_identity_drift");
});

test("runtime refreshes may change checked_at and quota without changing deployment identity", () => {
  const baseline = runtime();
  const refreshed = runtime({
    checked_at: "2026-09-04T00:00:15.000Z",
    quota: {
      limit: 100, remaining: 81, window_seconds: 60, concurrency_limit: 4,
      reset_at: "2026-09-04T00:01:00.000Z",
    },
  });
  const doctor = {
    contract: "reference-store-runtime-doctor/v1", ok: true, runtime: refreshed,
    checks: {
      deployment_mode: true, agent_core_status: true, expected_mode: true,
      credential_isolated: true, writes_disabled: true,
    },
  };
  const run = { contract: "reference-store-read-run/v1", runtime: refreshed, search: searchFor("known-product") };
  assert.equal(validateDoctorContract(doctor, baseline), doctor);
  assert.equal(validateRunContract(run, "known-product", `https://${SHOP}`, baseline), 1);
});

test("all browser request types enforce same-origin fixed runtime routes and write boundaries", () => {
  const config = directConfig();
  const allowed = safeCounts();
  observeBrowserRequest(config, allowed, {
    url: `https://${SHOP}/apps/reference-store/api/runtime/status`, method: "GET",
    resourceType: "fetch", headerNames: ["accept"],
  });
  observeBrowserRequest(config, allowed, {
    url: `https://${SHOP}/apps/reference-store/api/runs`, method: "POST",
    resourceType: "xhr", headerNames: ["content-type"],
  });
  assert.deepEqual(allowed, safeCounts());

  for (const resourceType of [
    "script", "document", "fetch", "xhr", "websocket", "eventsource", "manifest",
    "texttrack", "beacon", "ping", "other",
  ]) {
    const crossOrigin = safeCounts();
    observeBrowserRequest(config, crossOrigin, {
      url: `https://evil.example/resource-${resourceType}`, method: "GET", resourceType, headerNames: [],
    });
    assert.equal(crossOrigin.cross_origin_api_requests, 1, resourceType);
  }

  for (const resourceType of ["image", "stylesheet", "font", "media"]) {
    const allowedShopifyStatic = safeCounts();
    observeBrowserRequest(config, allowedShopifyStatic, {
      url: `https://cdn.shopify.com/resource-${resourceType}`, method: "GET", resourceType, headerNames: [],
    });
    assert.deepEqual(allowedShopifyStatic, safeCounts(), resourceType);
    const unknownStatic = safeCounts();
    observeBrowserRequest(config, unknownStatic, {
      url: `https://assets.evil.example/resource-${resourceType}`, method: "GET", resourceType, headerNames: [],
    });
    assert.equal(unknownStatic.cross_origin_api_requests, 1, resourceType);
  }

  const crossDocument = safeCounts();
  observeBrowserRequest(config, crossDocument, {
    url: "https://evil.example/form", method: "POST", resourceType: "document", headerNames: [],
  });
  assert.equal(crossDocument.cross_origin_api_requests, 1);
  assert.equal(crossDocument.browser_write_requests, 1);

  for (const resourceType of ["beacon", "ping", "other"]) {
    const beacon = safeCounts();
    observeBrowserRequest(config, beacon, {
      url: "https://metrics.example/ping", method: "POST", resourceType, headerNames: [],
    });
    assert.equal(beacon.cross_origin_api_requests, 1);
    assert.equal(beacon.browser_write_requests, 1);
  }

  const unknown = safeCounts();
  observeBrowserRequest(config, unknown, {
    url: `https://${SHOP}/apps/reference-store/api/delete`, method: "POST",
    resourceType: "document", headerNames: ["authorization"],
  });
  assert.equal(unknown.unexpected_api_requests, 1);
  assert.equal(unknown.browser_write_requests, 1);
  assert.equal(unknown.forbidden_browser_header_requests, 1);
});

test("synthetic response, missing expected product and browser boundary activity fail closed", async () => {
  const config = directConfig();
  const synthetic = await executeLiveGate({
    config,
    transport: transportFor(config.cases, {
      status: async () => runtime({ mode: "synthetic_local_sandbox", data_source: "synthetic_fixture" }),
    }),
  });
  assert.equal(synthetic.gate_status, "failed");
  assert.equal(synthetic.execution.failure_code, "invalid_live_runtime_contract");
  assert.equal(synthetic.boundaries.synthetic_fallback_count, 1);

  const missing = await executeLiveGate({
    config,
    transport: transportFor(config.cases, {
      run: async () => ({
        contract: "reference-store-read-run/v1",
        runtime: runtime(),
        search: searchFor("different-product"),
      }),
    }),
  });
  assert.equal(missing.gate_status, "failed");
  assert.equal(missing.execution.first_failure_case_id, "case_0000000000000001");
  assert.equal(missing.execution.failure_code, "live_case_expected_product_missing");

  const unsafe = await executeLiveGate({
    config,
    transport: transportFor(config.cases, {
      safety: async () => safeCounts({ cross_origin_api_requests: 1 }),
    }),
  });
  assert.equal(unsafe.gate_status, "failed");
  assert.equal(unsafe.execution.failure_code, "browser_safety_boundary_failed");
  assert.equal(unsafe.safety.cross_origin_api_requests, 1);

  const persistentStorage = await executeLiveGate({
    config,
    transport: transportFor(config.cases, {
      safety: async () => safeCounts({ browser_persistent_storage_hits: 1 }),
    }),
  });
  assert.equal(persistentStorage.gate_status, "failed");
  assert.equal(persistentStorage.execution.failure_code, "browser_safety_boundary_failed");
});

test("credential-shaped response fields fail closed without copying the value", async () => {
  const config = directConfig();
  const receipt = await executeLiveGate({
    config,
    transport: transportFor(config.cases, {
      status: async () => ({ ...runtime(), access_token: "do-not-copy-this" }),
    }),
  });
  assert.equal(receipt.gate_status, "failed");
  assert.equal(receipt.execution.failure_code, "credential_field_exposed");
  assert.equal(JSON.stringify(receipt).includes("do-not-copy-this"), false);
});

test("evidence is sanitized, content-addressed and no-clobber", async () => {
  await withSandbox(async (root) => {
    const outputRoot = path.join(root, "new-evidence");
    const config = directConfig({ outputRoot });
    const receipt = await executeLiveGate({ config, transport: transportFor(config.cases) });
    const hashes = await writeEvidence(config, receipt);
    const receiptBytes = await readFile(path.join(outputRoot, "receipt.json"));
    const manifestBytes = await readFile(path.join(outputRoot, "manifest.json"));
    const manifest = JSON.parse(manifestBytes);
    assert.equal(hashes.receipt_sha256, sha256(receiptBytes));
    assert.equal(manifest.receipt_sha256, hashes.receipt_sha256);
    assert.equal(manifest.receipt_bytes, receiptBytes.length);
    assert.equal((await readFile(path.join(outputRoot, "manifest.sha256"), "utf8")).startsWith(hashes.manifest_sha256), true);
    await assert.rejects(() => writeEvidence(config, receipt));
  });
});

test("receipt and manifest validators enforce nested closure and passed 10/10 cross-field invariants", async () => {
  const config = directConfig();
  const receipt = await executeLiveGate({ config, transport: transportFor(config.cases) });
  assert.equal(validateReceiptShape(receipt, config), receipt);
  const nine = structuredClone(receipt);
  nine.journeys.pop();
  nine.execution.passed_count = 9;
  nine.execution.attempted_count = 9;
  assert.throws(() => validateReceiptShape(nine, config), (error) => error.code === "invalid_receipt_shape");
  const duplicate = structuredClone(receipt);
  duplicate.journeys[9].case_id = duplicate.journeys[0].case_id;
  assert.throws(() => validateReceiptShape(duplicate, config), (error) => error.code === "invalid_receipt_shape");
  const nestedUnknown = structuredClone(receipt);
  nestedUnknown.execution.unexpected = true;
  assert.throws(() => validateReceiptShape(nestedUnknown, config), (error) => error.code === "invalid_receipt_shape");
  const mismatchedObserved = structuredClone(receipt);
  mismatchedObserved.observed_components = structuredClone(mismatchedObserved.observed_components);
  mismatchedObserved.observed_components.agent_core.commit = "7".repeat(40);
  assert.throws(() => validateReceiptShape(mismatchedObserved, config),
    (error) => error.code === "invalid_receipt_shape");
  const openAttestation = structuredClone(receipt);
  openAttestation.deployment_attestation.unexpected = true;
  assert.throws(() => validateReceiptShape(openAttestation, config),
    (error) => error.code === "invalid_receipt_shape");
  const unsignedPass = structuredClone(receipt);
  unsignedPass.deployment_attestation.verified = false;
  unsignedPass.deployment_attestation.descriptor_sha256 = null;
  assert.throws(() => validateReceiptShape(unsignedPass, config),
    (error) => error.code === "invalid_receipt_shape");

  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  const receiptDigest = sha256(receiptBytes);
  const manifest = {
    schema_version: "reference-store-live-app-proxy-manifest/v1",
    generated_at: CHECKED_AT,
    receipt_file: "receipt.json",
    receipt_bytes: receiptBytes.length,
    receipt_sha256: receiptDigest,
    cases_sha256: config.casesSha256,
  };
  assert.equal(validateManifestShape(manifest, {
    receiptBytes: receiptBytes.length, receiptDigest, casesSha256: config.casesSha256,
  }), manifest);
  assert.throws(() => validateManifestShape({ ...manifest, extra: true }, {
    receiptBytes: receiptBytes.length, receiptDigest, casesSha256: config.casesSha256,
  }), (error) => error.code === "invalid_evidence_manifest");
});

test("published case and receipt schemas recursively close every declared object", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  for (const filename of [
    "reference-store-live-app-proxy-cases.v1.schema.json",
    "reference-store-deployment-descriptor.v1.schema.json",
    "reference-store-live-app-proxy-manifest.v1.schema.json",
    "reference-store-live-app-proxy-receipt.v1.schema.json",
    "reference-store-read-run.v1.schema.json",
    "reference-store-runtime-doctor.v1.schema.json",
    "reference-store-runtime-status.v1.schema.json",
  ]) {
    const schema = JSON.parse(await readFile(path.join(root, "contracts", filename), "utf8"));
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      if (value.type === "object") assert.equal(value.additionalProperties, false, `${filename} has an open object`);
      Object.values(value).forEach(visit);
    };
    visit(schema);
  }
});

test("published passed-receipt schema encodes all runtime safety and live-boundary invariants", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const schema = JSON.parse(await readFile(path.join(
    root, "contracts", "reference-store-live-app-proxy-receipt.v1.schema.json",
  ), "utf8"));
  const passed = schema.allOf[0].then.properties;
  assert.deepEqual(Object.values(passed.safety.properties).map((entry) => entry.const), Array(10).fill(0));
  assert.equal(passed.boundaries.properties.actual_shopify_app_proxy_verified.const, true);
  assert.equal(passed.boundaries.properties.live_shopify_connection_verified.const, true);
  for (const name of [
    "synthetic_fallback_count", "successful_commerce_write_count", "raw_query_record_count",
    "raw_response_record_count", "cookie_record_count", "signature_record_count", "token_record_count",
  ]) assert.equal(passed.boundaries.properties[name].const, 0);
});
