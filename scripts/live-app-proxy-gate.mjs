import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  browserIdentity,
  createBrowserPage,
  loadPinnedPlaywright,
  probeBrowser,
} from "../shopify-theme/tests/liquid-browser-runtime.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
const CONFIRMATION = "READ_ONLY_APP_PROXY_10";
const RUNTIME_PREFIX = "/apps/reference-store";
const CASE_SCHEMA = "reference-store-live-app-proxy-cases/v1";
const RECEIPT_SCHEMA = "reference-store-live-app-proxy-receipt/v1";
const MANIFEST_SCHEMA = "reference-store-live-app-proxy-manifest/v1";
const HASH = /^[0-9a-f]{40}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CASE_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/u;
const HANDLE = /^[a-z0-9][a-z0-9-]{0,99}$/u;
const FORBIDDEN_PROCESS_SECRETS = Object.freeze([
  "SHOPIFY_APP_PROXY_SECRET",
  "SHOPIFY_STOREFRONT_ACCESS_TOKEN",
  "AGENT_CORE_SANDBOX_INVITE",
  "AGENT_CORE_SANDBOX_TOKEN",
  "AGENT_CORE_TENANT_KEY",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_API_SECRET",
]);
const FORBIDDEN_BROWSER_HEADERS = new Set([
  "authorization",
  "x-sandbox-invite",
  "x-shopify-access-token",
  "x-shopify-storefront-access-token",
]);
const LEGACY_PATHS = new Set(["/api/chat", "/api/search", "/api/catalog"]);
const RUNTIME_ROUTES = new Map([
  [`${RUNTIME_PREFIX}/api/runtime/status`, "GET"],
  [`${RUNTIME_PREFIX}/api/runtime/doctor`, "GET"],
  [`${RUNTIME_PREFIX}/api/runs`, "POST"],
]);

export class LiveGateError extends Error {
  constructor(code) {
    super(code);
    this.name = "LiveGateError";
    this.code = code;
  }
}

function fail(code) {
  throw new LiveGateError(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function required(environment, name) {
  const value = String(environment[name] || "").trim();
  if (!value) fail(`missing_${name.toLowerCase()}`);
  return value;
}

function safeIdentifier(value, name) {
  if (!SAFE_IDENTIFIER.test(value)) fail(`invalid_${name}`);
  return value;
}

function git(repositoryRoot, args) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    fail("repository_identity_unavailable");
  }
}

function outsideRepository(repositoryRoot, target, code) {
  if (!path.isAbsolute(target)) fail(code);
  const relative = path.relative(repositoryRoot, target);
  if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) fail(code);
}

export function validatePreviewIdentity({ previewUrl, shopDomain, themeId }) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u.test(shopDomain)) {
    fail("invalid_permanent_shop_domain");
  }
  if (!/^\d{6,20}$/u.test(themeId)) fail("invalid_unpublished_theme_id");
  let url;
  try { url = new URL(previewUrl); } catch { fail("invalid_preview_url"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || url.origin !== `https://${shopDomain}`) fail("invalid_preview_url");
  const allowed = new Set(["preview_theme_id", "_fd", "pb"]);
  for (const [key, value] of url.searchParams) {
    if (!allowed.has(key) || !/^[A-Za-z0-9_-]{1,32}$/u.test(value)) fail("invalid_preview_url_state");
  }
  if (url.searchParams.get("preview_theme_id") !== themeId) fail("preview_theme_identity_mismatch");
  return Object.freeze({ url: url.href, origin: url.origin, shopDomain, themeId });
}

export function validateCases(value) {
  if (!exactKeys(value, ["schema_version", "cases"]) || value.schema_version !== CASE_SCHEMA
    || !Array.isArray(value.cases) || value.cases.length !== 10) fail("invalid_live_case_manifest");
  const seen = new Set();
  const cases = value.cases.map((item) => {
    if (!exactKeys(item, ["case_id", "query", "expected_handle"])
      || !CASE_ID.test(item.case_id) || seen.has(item.case_id)
      || typeof item.query !== "string" || item.query !== item.query.trim()
      || item.query.length < 2 || item.query.length > 300 || /[\u0000-\u001f\u007f]/u.test(item.query)
      || !HANDLE.test(item.expected_handle)) fail("invalid_live_case_manifest");
    seen.add(item.case_id);
    return Object.freeze({ ...item });
  });
  return Object.freeze(cases);
}

export async function loadLiveGateConfig({
  environment = process.env,
  repositoryRoot = REPOSITORY_ROOT,
  nodeVersion = process.versions.node,
  repositoryIdentity,
} = {}) {
  if (String(nodeVersion).split(".")[0] !== "22") fail("node_22_required");
  if (environment.REFERENCE_STORE_LIVE_GATE_CONFIRM !== CONFIRMATION) fail("live_gate_not_confirmed");
  for (const name of FORBIDDEN_PROCESS_SECRETS) {
    if (String(environment[name] || "").trim()) fail("browser_harness_secret_present");
  }
  for (const [name, value] of Object.entries(environment)) {
    if (/^(?:SHOPIFY|AGENT_CORE).*(?:TOKEN|SECRET|INVITE|KEY)$/u.test(name)
      && String(value || "").trim()) fail("browser_harness_secret_present");
  }
  const browser = required(environment, "REFERENCE_STORE_LIVE_BROWSER");
  if (!["chromium", "firefox", "webkit"].includes(browser)) fail("invalid_live_browser");
  const preview = validatePreviewIdentity({
    previewUrl: required(environment, "REFERENCE_STORE_LIVE_PREVIEW_URL"),
    shopDomain: required(environment, "REFERENCE_STORE_EXPECTED_SHOP_DOMAIN").toLowerCase(),
    themeId: required(environment, "REFERENCE_STORE_EXPECTED_THEME_ID"),
  });
  const casesPath = path.resolve(required(environment, "REFERENCE_STORE_LIVE_CASES_PATH"));
  const requestedOutputRoot = path.resolve(required(environment, "REFERENCE_STORE_LIVE_EVIDENCE_ROOT"));
  let canonicalRepositoryRoot;
  let canonicalCasesPath;
  let canonicalOutputParent;
  try {
    canonicalRepositoryRoot = await realpath(repositoryRoot);
    canonicalCasesPath = await realpath(casesPath);
    canonicalOutputParent = await realpath(path.dirname(requestedOutputRoot));
  } catch { fail("external_path_identity_unavailable"); }
  const outputRoot = path.join(canonicalOutputParent, path.basename(requestedOutputRoot));
  outsideRepository(canonicalRepositoryRoot, canonicalCasesPath, "case_manifest_must_be_external");
  outsideRepository(canonicalRepositoryRoot, outputRoot, "evidence_root_must_be_external");
  let casesStat;
  try { casesStat = await stat(canonicalCasesPath); } catch { fail("case_manifest_unavailable"); }
  if (!casesStat.isFile()) fail("case_manifest_unavailable");
  try {
    await lstat(outputRoot);
    fail("evidence_root_already_exists");
  } catch (error) {
    if (error instanceof LiveGateError) throw error;
    if (error.code !== "ENOENT") fail("evidence_root_unavailable");
  }
  let rawCases;
  try { rawCases = await readFile(canonicalCasesPath); } catch { fail("case_manifest_unavailable"); }
  let parsedCases;
  try { parsedCases = JSON.parse(rawCases.toString("utf8")); } catch { fail("invalid_live_case_manifest"); }
  const cases = validateCases(parsedCases);
  const actual = repositoryIdentity || {
    commit: git(repositoryRoot, ["rev-parse", "HEAD"]),
    tree: git(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
    dirty: Boolean(git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=normal"])),
  };
  const expectedReferenceCommit = required(environment, "REFERENCE_STORE_EXPECTED_REFERENCE_COMMIT");
  const expectedReferenceTree = required(environment, "REFERENCE_STORE_EXPECTED_REFERENCE_TREE");
  if (!HASH.test(expectedReferenceCommit) || !HASH.test(expectedReferenceTree)
    || actual.commit !== expectedReferenceCommit || actual.tree !== expectedReferenceTree || actual.dirty) {
    fail("reference_store_identity_mismatch");
  }
  let packageManifest;
  try { packageManifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")); }
  catch { fail("package_identity_unavailable"); }
  const referenceVersion = required(environment, "REFERENCE_STORE_EXPECTED_REFERENCE_VERSION");
  if (packageManifest.version !== referenceVersion) fail("reference_store_version_mismatch");
  const bffCommit = required(environment, "REFERENCE_STORE_EXPECTED_BFF_COMMIT");
  if (bffCommit !== actual.commit) fail("bff_commit_mismatch");
  const agentCoreCommit = required(environment, "REFERENCE_STORE_EXPECTED_CORE_COMMIT");
  if (!HASH.test(agentCoreCommit)) fail("invalid_agent_core_commit");
  const config = {
    preview,
    browser,
    outputRoot,
    cases,
    casesSha256: sha256(rawCases),
    components: Object.freeze({
      reference_store: Object.freeze({
        commit: actual.commit,
        tree: actual.tree,
        version: safeIdentifier(referenceVersion, "reference_store_version"),
      }),
      agent_core: Object.freeze({
        commit: agentCoreCommit,
        version: safeIdentifier(required(environment, "REFERENCE_STORE_EXPECTED_CORE_VERSION"), "agent_core_version"),
      }),
      storefront_bff: Object.freeze({
        commit: bffCommit,
        version: safeIdentifier(required(environment, "REFERENCE_STORE_EXPECTED_BFF_VERSION"), "bff_version"),
      }),
    }),
  };
  return Object.freeze(config);
}

function validRuntime(value) {
  return value && value.contract === "reference-store-runtime-status/v1"
    && value.mode === "shopify_read_only" && value.connected === true
    && value.credential_state === "succeeded" && value.data_source === "shopify_storefront_graphql"
    && value.writes_disabled === true && value.capabilities?.catalog_search === true
    && value.capabilities?.search_contract_v2 === true
    && ["cart", "checkout", "order", "payment", "inventory", "publication", "product_mutation"]
      .every((capability) => value.capabilities?.[capability] === false)
    && value.boundaries?.non_transactional === true && value.boundaries?.purchasable === false
    && value.boundaries?.shipping_rates === false && value.boundaries?.commerce_writes === false
    && value.boundaries?.credential_exposed === false;
}

function assertRuntime(value) {
  if (!validRuntime(value)) fail("invalid_live_runtime_contract");
}

function assertNoCredentialFields(value) {
  const forbidden = /(?:^|_)(?:access_?token|authorization|client_?secret|cookie|hmac|password|signature|token|secret)(?:$|_)/iu;
  const visit = (current) => {
    if (Array.isArray(current)) return current.forEach(visit);
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.test(key)) fail("credential_field_exposed");
      visit(child);
    }
  };
  visit(value);
}

function assertRun(payload, expectedHandle) {
  if (!payload || payload.contract !== "reference-store-read-run/v1") fail("invalid_live_run_contract");
  assertRuntime(payload.runtime);
  const search = payload.search;
  if (!search || search.contract_version !== "2.0" || search.status !== "results"
    || !Array.isArray(search.results) || search.results.length < 1
    || !search.results.some((product) => product?.handle === expectedHandle)) {
    fail("live_case_expected_product_missing");
  }
  for (const product of search.results) {
    if (!product || product.synthetic !== false || product.writes !== false
      || product.non_transactional !== true || product.purchasable !== false
      || product.shipping_rates !== false) fail("invalid_live_product_boundary");
  }
  assertNoCredentialFields(payload);
  return search.results.length;
}

function observedBoundaryViolations(payload) {
  const text = payload && typeof payload === "object" ? payload : {};
  const runtime = text.runtime || text;
  const search = text.search || {};
  const products = Array.isArray(search.results) ? search.results : [];
  return {
    synthetic_fallback_count: Number(
      runtime.mode === "synthetic_local_sandbox"
      || runtime.data_source === "synthetic_fixture"
      || search.mode === "synthetic_local_sandbox"
      || search.data_source === "synthetic_fixture"
      || search.illustrative_only === true
      || products.some((product) => product?.synthetic === true),
    ),
    successful_commerce_write_count: Number(
      runtime.writes_disabled === false
      || runtime.boundaries?.commerce_writes === true
      || search.writes === true
      || products.some((product) => product?.writes === true),
    ),
  };
}

function initialSafety() {
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
  };
}

function safeFailure(error) {
  if (error instanceof LiveGateError && /^[a-z0-9_]{3,80}$/u.test(error.code)) return error.code;
  return "live_gate_execution_failed";
}

function networkIsClean(safety) {
  return Object.values(safety).every((value) => value === 0);
}

export async function executeLiveGate({ config, transport, now = () => Date.now() }) {
  const journeys = [];
  const safety = initialSafety();
  const observed = { synthetic_fallback_count: 0, successful_commerce_write_count: 0 };
  let failureCode = null;
  let firstFailureCaseId = null;
  try {
    const status = await transport.status();
    Object.assign(observed, observedBoundaryViolations(status));
    assertNoCredentialFields(status);
    assertRuntime(status);
    const doctor = await transport.doctor();
    const doctorViolations = observedBoundaryViolations(doctor);
    observed.synthetic_fallback_count += doctorViolations.synthetic_fallback_count;
    observed.successful_commerce_write_count += doctorViolations.successful_commerce_write_count;
    assertNoCredentialFields(doctor);
    if (!doctor || doctor.contract !== "reference-store-runtime-doctor/v1" || doctor.ok !== true
      || !doctor.checks || Object.values(doctor.checks).some((value) => value !== true)) {
      fail("live_doctor_failed");
    }
    assertRuntime(doctor.runtime);
    for (const item of config.cases) {
      const started = now();
      try {
        const payload = await transport.run(item.query);
        const runViolations = observedBoundaryViolations(payload);
        observed.synthetic_fallback_count += runViolations.synthetic_fallback_count;
        observed.successful_commerce_write_count += runViolations.successful_commerce_write_count;
        const resultCount = assertRun(payload, item.expected_handle);
        journeys.push(Object.freeze({
          case_id: item.case_id,
          status: "passed",
          result_count: resultCount,
          latency_ms: Math.max(0, Math.round(now() - started)),
        }));
      } catch (error) {
        firstFailureCaseId = item.case_id;
        throw error;
      }
    }
    Object.assign(safety, await transport.safety(config.cases.map((item) => item.query)));
    if (!networkIsClean(safety)) fail("browser_safety_boundary_failed");
  } catch (error) {
    failureCode = safeFailure(error);
    try { Object.assign(safety, await transport.safety(config.cases.map((item) => item.query))); }
    catch { /* Preserve the first closed failure. */ }
  } finally {
    await transport.close().catch(() => {});
  }
  const passed = !failureCode && journeys.length === 10 && networkIsClean(safety);
  if (!passed && !failureCode) failureCode = "incomplete_live_gate";
  return Object.freeze({
    schema_version: RECEIPT_SCHEMA,
    generated_at: new Date().toISOString(),
    gate_status: passed ? "passed" : "failed",
    claim_scope: "real_unpublished_shopify_app_proxy_read_only",
    expected_components: config.components,
    shopify: Object.freeze({
      permanent_shop_domain_sha256: sha256(config.preview.shopDomain),
      storefront_origin_sha256: sha256(config.preview.origin),
      unpublished_theme_id: config.preview.themeId,
    }),
    inputs: Object.freeze({ cases_sha256: config.casesSha256, case_count: 10 }),
    execution: Object.freeze({
      browser: config.browser,
      attempted_count: journeys.length + (firstFailureCaseId ? 1 : 0),
      passed_count: journeys.length,
      failed_count: firstFailureCaseId ? 1 : 0,
      first_failure_case_id: firstFailureCaseId,
      failure_code: failureCode,
    }),
    safety: Object.freeze(safety),
    boundaries: Object.freeze({
      actual_shopify_app_proxy_verified: passed,
      live_shopify_connection_verified: passed,
      synthetic_fallback_count: observed.synthetic_fallback_count,
      successful_commerce_write_count: observed.successful_commerce_write_count,
      raw_query_record_count: 0,
      raw_response_record_count: 0,
      cookie_record_count: 0,
      signature_record_count: 0,
      token_record_count: 0,
    }),
    journeys: Object.freeze(journeys),
  });
}

async function jsonFetch(page, route, body) {
  const result = await page.evaluate(async ({ route: relative, body: payload }) => {
    const response = await fetch(relative, {
      method: payload === null ? "GET" : "POST",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: { accept: "application/json", ...(payload === null ? {} : { "content-type": "application/json" }) },
      ...(payload === null ? {} : { body: JSON.stringify(payload) }),
    });
    const contentType = response.headers.get("content-type") || "";
    if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) return { ok: false, status: response.status };
    return { ok: response.ok, status: response.status, payload: await response.json() };
  }, { route, body: body ?? null });
  if (!result.ok || !result.payload) fail("live_runtime_request_failed");
  return result.payload;
}

export async function createPlaywrightTransport(config, { repositoryRoot = REPOSITORY_ROOT } = {}) {
  const runtime = await loadPinnedPlaywright(repositoryRoot);
  const engine = runtime.playwright[config.browser];
  const executablePath = process.env[`${config.browser.toUpperCase()}_PATH`]
    || runtime.descriptors[config.browser].executablePath;
  let browser;
  let context;
  let page;
  try {
    browser = await engine.launch({ headless: true, executablePath });
    await browserIdentity(browser, config.browser, executablePath, runtime);
    await probeBrowser(browser, () => {});
    ({ context, page } = await createBrowserPage(browser, { width: 1440, height: 1000 }));
  } catch {
    await browser?.close().catch(() => {});
    fail("live_browser_unavailable");
  }
  const counters = initialSafety();
  page.on("console", (message) => { if (message.type() === "error") counters.console_errors += 1; });
  page.on("pageerror", () => { counters.page_errors += 1; });
  page.on("request", (request) => {
    if (!["fetch", "xhr", "websocket", "eventsource"].includes(request.resourceType())) return;
    let url;
    try { url = new URL(request.url()); } catch { counters.unexpected_api_requests += 1; return; }
    if (url.origin !== config.preview.origin) counters.cross_origin_api_requests += 1;
    const pathname = url.pathname;
    if (LEGACY_PATHS.has(pathname) || [...LEGACY_PATHS].some((legacy) => pathname.endsWith(legacy))) {
      counters.legacy_route_requests += 1;
    }
    const expectedMethod = RUNTIME_ROUTES.get(pathname);
    if (url.origin === config.preview.origin && (!expectedMethod || expectedMethod !== request.method() || url.search)) {
      counters.unexpected_api_requests += 1;
    }
    if (request.method() !== "GET" && pathname !== `${RUNTIME_PREFIX}/api/runs`) {
      counters.browser_write_requests += 1;
    }
    const headerNames = Object.keys(request.headers()).map((name) => name.toLowerCase());
    if (headerNames.some((name) => FORBIDDEN_BROWSER_HEADERS.has(name))) {
      counters.forbidden_browser_header_requests += 1;
    }
  });
  let navigation;
  try {
    navigation = await page.goto(config.preview.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  } catch {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    fail("unpublished_theme_preview_unavailable");
  }
  if (!navigation?.ok() || new URL(page.url()).origin !== config.preview.origin) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    fail("unpublished_theme_preview_identity_mismatch");
  }
  return Object.freeze({
    status: () => jsonFetch(page, `${RUNTIME_PREFIX}/api/runtime/status`),
    doctor: () => jsonFetch(page, `${RUNTIME_PREFIX}/api/runtime/doctor`),
    run: (query) => jsonFetch(page, `${RUNTIME_PREFIX}/api/runs`, { query, limit: 20 }),
    safety: async (queries) => {
      const storage = await page.evaluate((rawQueries) => {
        const forbidden = /(?:access[_-]?token|authorization|client[_-]?secret|credential|hmac|password|signature|x-sandbox-invite)/iu;
        let credentialHits = 0;
        let queryHits = 0;
        const inspect = (key, value) => {
          if (forbidden.test(String(key)) || forbidden.test(String(value))) credentialHits += 1;
          if (rawQueries.some((query) => String(value).includes(query))) queryHits += 1;
        };
        for (const storage of [localStorage, sessionStorage]) {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index) || "";
            inspect(key, storage.getItem(key) || "");
          }
        }
        for (const item of document.cookie.split(";")) inspect(item.split("=", 1)[0], "");
        return { credentialHits, queryHits };
      }, queries);
      return {
        ...counters,
        browser_storage_credential_hits: storage.credentialHits,
        browser_storage_query_hits: storage.queryHits,
      };
    },
    close: async () => {
      await context.close();
      await browser.close();
    },
  });
}

export function validateReceiptShape(receipt) {
  const topKeys = [
    "schema_version", "generated_at", "gate_status", "claim_scope", "expected_components", "shopify",
    "inputs", "execution", "safety", "boundaries", "journeys",
  ];
  if (!exactKeys(receipt, topKeys) || receipt.schema_version !== RECEIPT_SCHEMA
    || !["passed", "failed"].includes(receipt.gate_status)
    || !Array.isArray(receipt.journeys) || receipt.journeys.length > 10) fail("invalid_receipt_shape");
  return receipt;
}

export async function writeEvidence(config, receipt) {
  validateReceiptShape(receipt);
  await mkdir(config.outputRoot, { recursive: false });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const receiptDigest = sha256(receiptBytes);
  const manifest = {
    schema_version: MANIFEST_SCHEMA,
    generated_at: new Date().toISOString(),
    receipt_file: "receipt.json",
    receipt_bytes: receiptBytes.length,
    receipt_sha256: receiptDigest,
    cases_sha256: config.casesSha256,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const manifestDigest = sha256(manifestBytes);
  await writeFile(path.join(config.outputRoot, "receipt.json"), receiptBytes, { flag: "wx" });
  await writeFile(path.join(config.outputRoot, "manifest.json"), manifestBytes, { flag: "wx" });
  await writeFile(path.join(config.outputRoot, "manifest.sha256"), `${manifestDigest}  manifest.json\n`, { flag: "wx" });
  return Object.freeze({ receipt_sha256: receiptDigest, manifest_sha256: manifestDigest });
}

export async function main() {
  let config;
  try {
    config = await loadLiveGateConfig();
    const transport = await createPlaywrightTransport(config);
    const receipt = await executeLiveGate({ config, transport });
    const hashes = await writeEvidence(config, receipt);
    if (receipt.gate_status !== "passed") fail(receipt.execution.failure_code || "live_gate_failed");
    process.stdout.write(`PASS: real unpublished Shopify App Proxy 10/10; receipt ${hashes.receipt_sha256}\n`);
  } catch (error) {
    const code = safeFailure(error);
    process.stderr.write(`FAIL: ${code}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
