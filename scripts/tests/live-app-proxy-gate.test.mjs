import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  executeLiveGate,
  LiveGateError,
  loadLiveGateConfig,
  validateCases,
  validatePreviewIdentity,
  writeEvidence,
} from "../live-app-proxy-gate.mjs";

const REFERENCE_COMMIT = "1".repeat(40);
const REFERENCE_TREE = "2".repeat(40);
const CORE_COMMIT = "3".repeat(40);
const SHOP = "reference-gate.myshopify.com";
const THEME = "123456789012";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function caseManifest() {
  return {
    schema_version: "reference-store-live-app-proxy-cases/v1",
    cases: Array.from({ length: 10 }, (_, index) => ({
      case_id: `known_${String(index + 1).padStart(2, "0")}`,
      query: `private known query ${index + 1}`,
      expected_handle: `expected-product-${index + 1}`,
    })),
  };
}

function runtime(overrides = {}) {
  return {
    contract: "reference-store-runtime-status/v1",
    mode: "shopify_read_only",
    connected: true,
    credential_state: "succeeded",
    data_source: "shopify_storefront_graphql",
    writes_disabled: true,
    capabilities: {
      catalog_search: true,
      search_contract_v2: true,
      cart: false,
      checkout: false,
      order: false,
      payment: false,
      inventory: false,
      publication: false,
      product_mutation: false,
    },
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

function safeCounts(overrides = {}) {
  return {
    cross_origin_api_requests: 0,
    legacy_route_requests: 0,
    unexpected_api_requests: 0,
    browser_write_requests: 0,
    forbidden_browser_header_requests: 0,
    browser_storage_credential_hits: 0,
    browser_storage_query_hits: 0,
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
      checks: { deployment_mode: true, expected_mode: true, credential_isolated: true, writes_disabled: true },
    }),
    run: async (query) => ({
      contract: "reference-store-read-run/v1",
      runtime: runtime(),
      search: {
        contract_version: "2.0",
        status: "results",
        mode: "shopify_read_only",
        data_source: "shopify_storefront_graphql",
        results: [{
          handle: handles.get(query),
          synthetic: false,
          writes: false,
          non_transactional: true,
          purchasable: false,
          shipping_rates: false,
        }],
      },
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
    components: {
      reference_store: { commit: REFERENCE_COMMIT, tree: REFERENCE_TREE, version: "1.1.0" },
      agent_core: { commit: CORE_COMMIT, version: "1.2.0" },
      storefront_bff: { commit: REFERENCE_COMMIT, version: "1.1.0" },
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
  const outputRoot = path.join(privateRoot, "evidence");
  await mkdir(repositoryRoot);
  await mkdir(privateRoot);
  await writeFile(path.join(repositoryRoot, "package.json"), '{"version":"1.1.0"}\n');
  const manifest = options.manifest || caseManifest();
  await writeFile(casesPath, `${JSON.stringify(manifest)}\n`);
  const environment = {
    REFERENCE_STORE_LIVE_GATE_CONFIRM: "READ_ONLY_APP_PROXY_10",
    REFERENCE_STORE_LIVE_BROWSER: "chromium",
    REFERENCE_STORE_LIVE_PREVIEW_URL: `https://${SHOP}/?preview_theme_id=${THEME}&_fd=0&pb=0`,
    REFERENCE_STORE_EXPECTED_SHOP_DOMAIN: SHOP,
    REFERENCE_STORE_EXPECTED_THEME_ID: THEME,
    REFERENCE_STORE_LIVE_CASES_PATH: casesPath,
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
    await assert.rejects(() => loadLiveGateConfig({
      ...fixture,
      environment: { ...fixture.environment, REFERENCE_STORE_EXPECTED_BFF_COMMIT: CORE_COMMIT },
      nodeVersion: "22.23.2",
    }), (error) => error.code === "bff_commit_mismatch");
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
        search: {
          contract_version: "2.0", status: "results", mode: "shopify_read_only",
          data_source: "shopify_storefront_graphql", results: [],
        },
      }),
    }),
  });
  assert.equal(missing.gate_status, "failed");
  assert.equal(missing.execution.first_failure_case_id, "known_01");
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

test("published case and receipt schemas recursively close every declared object", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  for (const filename of [
    "reference-store-live-app-proxy-cases.v1.schema.json",
    "reference-store-live-app-proxy-receipt.v1.schema.json",
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
