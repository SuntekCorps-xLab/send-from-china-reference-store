import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
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
const DEPLOYMENT_DESCRIPTOR_SCHEMA = "reference-store-deployment-descriptor/v1";
const DEPLOYMENT_ATTESTATION_SCHEMA = "reference-store-deployment-attestation/v1";
const HASH = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ED25519_SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const CASE_ID = /^case_[0-9a-f]{16,32}$/u;
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
const PASSIVE_CROSS_ORIGIN_RESOURCE_TYPES = new Set(["image", "stylesheet", "font", "media"]);
const SHOPIFY_STATIC_HOSTS = new Set(["cdn.shopify.com", "fonts.shopifycdn.com"]);
const RUNTIME_ROUTES = new Map([
  [`${RUNTIME_PREFIX}/api/runtime/status`, "GET"],
  [`${RUNTIME_PREFIX}/api/runtime/doctor`, "GET"],
  [`${RUNTIME_PREFIX}/api/runs`, "POST"],
]);
const COMPONENT_KEYS = ["reference_store", "agent_core", "storefront_bff"];
const REPOSITORY_COMPONENT_KEYS = ["commit", "tree", "version"];
const SERVICE_COMPONENT_KEYS = ["commit", "version"];
const RUNTIME_KEYS = [
  "contract", "source_contract", "mode", "connected", "credential_state", "data_source",
  "api_version", "quota", "writes_disabled", "capabilities", "checked_at", "error_code",
  "boundaries", "components", "deployment_attestation",
];
const DEPLOYMENT_ATTESTATION_KEYS = [
  "contract", "algorithm", "key_id", "descriptor_sha256", "signature",
];
const RUNTIME_QUOTA_KEYS = ["limit", "remaining", "window_seconds", "concurrency_limit", "reset_at"];
const RUNTIME_CAPABILITY_KEYS = [
  "doctor", "catalog_search", "search_contract_v2", "product_detail", "storefront_health",
];
const RUNTIME_BOUNDARY_KEYS = [
  "non_transactional", "purchasable", "shipping_rates", "commerce_writes", "credential_exposed",
];
const CONDITION_KEYS = ["name", "value", "source", "scope", "hardness"];
const SEARCH_KEYS = [
  "contract_version", "trace_id", "status", "normalized_intent", "relaxations",
  "missing_criteria", "results", "pagination", "search_scope",
];
const INTENT_KEYS = ["product_identity", "hard_constraints", "soft_context", "transaction_context"];
const PAGINATION_KEYS = ["limit", "cursor", "next_cursor", "has_more"];
const SEARCH_SCOPE_KEYS = [
  "plan_complete", "scope_exhausted", "global_catalog_exhaustive", "scan_limit_reached",
  "degraded", "degraded_reason",
];
const PRODUCT_KEYS = [
  "public_id", "handle", "title", "summary", "image", "price", "available_for_sale",
  "product_url", "shopify_verified_at", "synthetic", "non_transactional", "purchasable",
  "writes", "shipping_rates",
];
const SAFETY_KEYS = [
  "cross_origin_api_requests", "legacy_route_requests", "unexpected_api_requests",
  "browser_write_requests", "forbidden_browser_header_requests", "browser_storage_credential_hits",
  "browser_storage_query_hits", "browser_persistent_storage_hits", "console_errors", "page_errors",
];
const RECEIPT_BOUNDARY_KEYS = [
  "actual_shopify_app_proxy_verified", "live_shopify_connection_verified",
  "synthetic_fallback_count", "successful_commerce_write_count", "raw_query_record_count",
  "raw_response_record_count", "cookie_record_count", "signature_record_count", "token_record_count",
];
const RECEIPT_ATTESTATION_KEYS = [
  "verified", "signing_key_id", "public_key_sha256", "descriptor_sha256",
];

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

function exactCanonicalValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => exactCanonicalValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key)
      && exactCanonicalValue(left[key], right[key]));
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

function deploymentDescriptor(components) {
  return Object.freeze({
    components,
    schema_version: DEPLOYMENT_DESCRIPTOR_SCHEMA,
  });
}

function decodeBase64Url(value) {
  if (!ED25519_SIGNATURE.test(value)) fail("invalid_deployment_attestation");
  try { return Buffer.from(value, "base64url"); } catch { fail("invalid_deployment_attestation"); }
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function nonnegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validComponentIdentities(value) {
  return exactKeys(value, COMPONENT_KEYS)
    && exactKeys(value.reference_store, REPOSITORY_COMPONENT_KEYS)
    && HASH.test(value.reference_store.commit) && HASH.test(value.reference_store.tree)
    && SAFE_IDENTIFIER.test(value.reference_store.version)
    && exactKeys(value.agent_core, SERVICE_COMPONENT_KEYS)
    && HASH.test(value.agent_core.commit) && SAFE_IDENTIFIER.test(value.agent_core.version)
    && exactKeys(value.storefront_bff, SERVICE_COMPONENT_KEYS)
    && HASH.test(value.storefront_bff.commit) && SAFE_IDENTIFIER.test(value.storefront_bff.version)
    && value.reference_store.commit === value.storefront_bff.commit;
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
    || !value.cases || typeof value.cases !== "object" || Array.isArray(value.cases)
    || Object.keys(value.cases).length !== 10) fail("invalid_live_case_manifest");
  const entries = Object.entries(value.cases);
  const caseIds = new Set(entries.map(([caseId]) => caseId));
  for (const [caseId, item] of entries) {
    if (!CASE_ID.test(caseId) || !exactKeys(item, ["query", "expected_handle"])
      || typeof item.query !== "string" || item.query !== item.query.trim()
      || [...item.query].length < 2 || [...item.query].length > 300
      || !HANDLE.test(item.expected_handle)) fail("invalid_live_case_manifest");
  }
  const seenQueries = new Set();
  const seenHandles = new Set();
  const cases = entries.map(([caseId, item]) => {
    const normalizedQuery = item.query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
    if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(item.query)
      || [...caseIds].some((candidate) => candidate.includes(normalizedQuery)
        || normalizedQuery.includes(candidate))
      || normalizedQuery === item.expected_handle
      || seenQueries.has(normalizedQuery) || seenHandles.has(item.expected_handle)) {
      fail("invalid_live_case_manifest");
    }
    seenQueries.add(normalizedQuery);
    seenHandles.add(item.expected_handle);
    return Object.freeze({ case_id: caseId, ...item });
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
  for (const [name, value] of Object.entries(environment)) {
    const normalizedName = name.toUpperCase();
    if ((FORBIDDEN_PROCESS_SECRETS.includes(normalizedName)
      || /^(?:SHOPIFY|AGENT_CORE)(?:_|$)(?:[A-Z0-9]+_)*(?:TOKEN|SECRET|INVITE|KEY|CREDENTIALS?|PASSWORD)(?:_|$)/u.test(normalizedName))
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
  const publicKeyPath = path.resolve(required(environment, "REFERENCE_STORE_DEPLOYMENT_PUBLIC_KEY_PATH"));
  const requestedOutputRoot = path.resolve(required(environment, "REFERENCE_STORE_LIVE_EVIDENCE_ROOT"));
  let canonicalRepositoryRoot;
  let canonicalCasesPath;
  let canonicalPublicKeyPath;
  let canonicalOutputParent;
  try {
    canonicalRepositoryRoot = await realpath(repositoryRoot);
    canonicalCasesPath = await realpath(casesPath);
    canonicalPublicKeyPath = await realpath(publicKeyPath);
    canonicalOutputParent = await realpath(path.dirname(requestedOutputRoot));
  } catch { fail("external_path_identity_unavailable"); }
  const outputRoot = path.join(canonicalOutputParent, path.basename(requestedOutputRoot));
  outsideRepository(canonicalRepositoryRoot, canonicalCasesPath, "case_manifest_must_be_external");
  outsideRepository(canonicalRepositoryRoot, canonicalPublicKeyPath, "deployment_public_key_must_be_external");
  outsideRepository(canonicalRepositoryRoot, outputRoot, "evidence_root_must_be_external");
  let casesStat;
  try { casesStat = await stat(canonicalCasesPath); } catch { fail("case_manifest_unavailable"); }
  if (!casesStat.isFile()) fail("case_manifest_unavailable");
  let publicKeyStat;
  try { publicKeyStat = await stat(canonicalPublicKeyPath); } catch { fail("deployment_public_key_unavailable"); }
  if (!publicKeyStat.isFile()) fail("deployment_public_key_unavailable");
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
  let deploymentPublicKey;
  try {
    const publicKeyBytes = await readFile(canonicalPublicKeyPath);
    deploymentPublicKey = createPublicKey(publicKeyBytes);
  } catch { fail("invalid_deployment_public_key"); }
  if (deploymentPublicKey.type !== "public" || deploymentPublicKey.asymmetricKeyType !== "ed25519") {
    fail("invalid_deployment_public_key");
  }
  const publicKeySha256 = sha256(deploymentPublicKey.export({ type: "spki", format: "der" }));
  if (publicKeySha256 !== required(environment, "REFERENCE_STORE_DEPLOYMENT_PUBLIC_KEY_SHA256")) {
    fail("deployment_public_key_identity_mismatch");
  }
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
    deploymentSigner: Object.freeze({
      keyId: safeIdentifier(required(environment, "REFERENCE_STORE_DEPLOYMENT_SIGNING_KEY_ID"), "deployment_signing_key_id"),
      publicKey: deploymentPublicKey,
      publicKeySha256,
    }),
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

export function validateRuntimeContract(value) {
  assertNoCredentialFields(value);
  if (!exactKeys(value, RUNTIME_KEYS)
    || value.contract !== "reference-store-runtime-status/v1"
    || value.source_contract !== "shopify-live-sandbox-status/v1"
    || value.mode !== "shopify_read_only" || value.connected !== true
    || value.credential_state !== "succeeded" || value.data_source !== "shopify_storefront_graphql"
    || value.api_version !== "2026-07" || value.writes_disabled !== true
    || !exactKeys(value.quota, RUNTIME_QUOTA_KEYS)
    || !["limit", "remaining", "window_seconds", "concurrency_limit"]
      .every((field) => nonnegativeInteger(value.quota[field]))
    || value.quota.remaining > value.quota.limit
    || !(value.quota.reset_at === null || exactIsoTimestamp(value.quota.reset_at))
    || !exactKeys(value.capabilities, RUNTIME_CAPABILITY_KEYS)
    || !RUNTIME_CAPABILITY_KEYS.every((field) => value.capabilities[field] === true)
    || !exactIsoTimestamp(value.checked_at) || value.error_code !== null
    || !exactKeys(value.boundaries, RUNTIME_BOUNDARY_KEYS)
    || value.boundaries.non_transactional !== true || value.boundaries.purchasable !== false
    || value.boundaries.shipping_rates !== false || value.boundaries.commerce_writes !== false
    || value.boundaries.credential_exposed !== false
    || !validComponentIdentities(value.components)
    || !exactKeys(value.deployment_attestation, DEPLOYMENT_ATTESTATION_KEYS)
    || value.deployment_attestation.contract !== DEPLOYMENT_ATTESTATION_SCHEMA
    || value.deployment_attestation.algorithm !== "Ed25519"
    || !SAFE_IDENTIFIER.test(value.deployment_attestation.key_id)
    || !DIGEST.test(value.deployment_attestation.descriptor_sha256)
    || !ED25519_SIGNATURE.test(value.deployment_attestation.signature)
    || value.deployment_attestation.descriptor_sha256
      !== sha256(canonicalJson(deploymentDescriptor(value.components)))) fail("invalid_live_runtime_contract");
  return value;
}

function assertExpectedComponents(observed, expected) {
  if (!validComponentIdentities(expected) || !exactCanonicalValue(observed, expected)) {
    fail("deployed_component_identity_mismatch");
  }
}

function assertSignedDeployment(runtime, config) {
  const attestation = runtime.deployment_attestation;
  if (!config?.deploymentSigner || attestation.key_id !== config.deploymentSigner.keyId
    || attestation.descriptor_sha256
      !== sha256(canonicalJson(deploymentDescriptor(runtime.components)))) {
    fail("deployed_component_identity_mismatch");
  }
  const signature = decodeBase64Url(attestation.signature);
  if (signature.length !== 64 || !verifySignature(
    null,
    Buffer.from(canonicalJson(deploymentDescriptor(runtime.components)), "utf8"),
    config.deploymentSigner.publicKey,
    signature,
  )) fail("deployment_attestation_invalid");
  return attestation.descriptor_sha256;
}

function assertRuntimeInvariants(observed, baseline) {
  const stableKeys = RUNTIME_KEYS.filter((key) => key !== "quota" && key !== "checked_at");
  const stable = (runtime) => Object.fromEntries(stableKeys.map((key) => [key, runtime[key]]));
  if (!exactCanonicalValue(stable(observed), stable(baseline))) fail("runtime_identity_drift");
}

function assertNoCredentialFields(value) {
  const forbidden = /(?:^|_)(?:access_?token|authorization|client_?secret|cookie|hmac|password|signature|token|secret)(?:$|_)/iu;
  const visit = (current) => {
    if (Array.isArray(current)) return current.forEach(visit);
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      if (key === "signature" && current.contract === DEPLOYMENT_ATTESTATION_SCHEMA) continue;
      if (forbidden.test(key)) fail("credential_field_exposed");
      visit(child);
    }
  };
  visit(value);
}

function validConditionValue(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.length >= 1 && values.length <= 50 && values.every((item) => (
    (typeof item === "string" && item.trim() && item.length <= 300)
      || (typeof item === "number" && Number.isFinite(item))
      || typeof item === "boolean"
  ));
}

function validCondition(value) {
  return exactKeys(value, CONDITION_KEYS)
    && /^[a-z][a-z0-9_]{0,63}$/u.test(value.name)
    && validConditionValue(value.value)
    && ["explicit", "inferred", "default"].includes(value.source)
    && ["product", "session", "transaction"].includes(value.scope)
    && ["hard", "soft", "informational"].includes(value.hardness);
}

function validRelaxation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !["condition", "from", "to", "reason"].includes(key))
    || !Object.hasOwn(value, "condition") || !Object.hasOwn(value, "reason")
    || !/^[a-z][a-z0-9_]{0,63}$/u.test(value.condition)
    || typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 300) return false;
  return ["from", "to"].every((key) => !Object.hasOwn(value, key)
    || ["string", "number", "boolean"].includes(typeof value[key]));
}

function validHttpsUrl(value, expectedOrigin, expectedPath = "") {
  if (typeof value !== "string") return false;
  if (!value && !expectedPath) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && !url.search && !url.hash && (!expectedOrigin || url.origin === expectedOrigin)
      && (!expectedPath || url.pathname === expectedPath)
      && publicDnsHostname(url.hostname);
  } catch {
    return false;
  }
}

function publicDnsHostname(value) {
  const hostname = String(value || "").toLowerCase();
  if (!hostname || hostname.endsWith(".") || hostname.length > 253 || !hostname.includes(".")
    || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")
    || hostname.endsWith(".internal") || hostname.endsWith(".corp") || hostname.endsWith(".lan")
    || hostname.endsWith(".localdomain") || hostname.endsWith(".home.arpa")
    || /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname) || hostname.includes(":")) return false;
  return hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
}

function validateLiveProduct(product, previewOrigin) {
  if (!exactKeys(product, PRODUCT_KEYS)
    || typeof product.public_id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/u.test(product.public_id)
    || typeof product.handle !== "string" || !HANDLE.test(product.handle)
    || typeof product.title !== "string" || !product.title.trim() || product.title.length > 300
    || typeof product.summary !== "string" || product.summary.length > 5_000
    || typeof product.image !== "string" || (product.image && !validHttpsUrl(product.image, ""))
    || !exactKeys(product.price, ["amount", "currency"])
    || typeof product.price.amount !== "number" || !Number.isFinite(product.price.amount)
    || product.price.amount < 0 || !/^[A-Z]{3}$/u.test(product.price.currency)
    || typeof product.available_for_sale !== "boolean"
    || !validHttpsUrl(product.product_url, previewOrigin, `/products/${product.handle}`)
    || !exactIsoTimestamp(product.shopify_verified_at)
    || product.synthetic !== false || product.non_transactional !== true
    || product.purchasable !== false || product.writes !== false || product.shipping_rates !== false) {
    fail("invalid_live_product_boundary");
  }
}

function validateSearch(search, expectedHandle, previewOrigin) {
  if (!exactKeys(search, SEARCH_KEYS) || search.contract_version !== "2.0"
    || typeof search.trace_id !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/u.test(search.trace_id)
    || search.status !== "results" || !exactKeys(search.normalized_intent, INTENT_KEYS)
    || !validCondition(search.normalized_intent.product_identity)
    || search.normalized_intent.product_identity.name !== "product_identity"
    || !["hard_constraints", "soft_context", "transaction_context"].every((key) => (
      Array.isArray(search.normalized_intent[key]) && search.normalized_intent[key].length <= 50
        && search.normalized_intent[key].every(validCondition)
    ))
    || !Array.isArray(search.relaxations) || search.relaxations.length > 100
    || !search.relaxations.every(validRelaxation)
    || !Array.isArray(search.missing_criteria) || search.missing_criteria.length > 50
    || !search.missing_criteria.every((item) => typeof item === "string"
      && /^[a-z][a-z0-9_]{0,63}$/u.test(item))
    || !Array.isArray(search.results) || search.results.length < 1 || search.results.length > 20
    || !exactKeys(search.pagination, PAGINATION_KEYS)
    || !Number.isInteger(search.pagination.limit) || search.pagination.limit < 1
    || search.pagination.limit > 20 || search.results.length > search.pagination.limit
    || !(search.pagination.cursor === null || (typeof search.pagination.cursor === "string"
      && search.pagination.cursor.length <= 1_000))
    || !(search.pagination.next_cursor === null || (typeof search.pagination.next_cursor === "string"
      && search.pagination.next_cursor.length <= 1_000))
    || typeof search.pagination.has_more !== "boolean"
    || search.pagination.has_more !== Boolean(search.pagination.next_cursor)
    || !exactKeys(search.search_scope, SEARCH_SCOPE_KEYS)
    || !["plan_complete", "scope_exhausted", "global_catalog_exhaustive", "scan_limit_reached", "degraded"]
      .every((key) => typeof search.search_scope[key] === "boolean")
    || search.search_scope.degraded !== false
    || !(search.search_scope.degraded_reason === null
      || (typeof search.search_scope.degraded_reason === "string"
        && search.search_scope.degraded_reason.length <= 200))) fail("invalid_live_run_contract");
  search.results.forEach((product) => validateLiveProduct(product, previewOrigin));
  if (!search.results.some((product) => product.handle === expectedHandle)) {
    fail("live_case_expected_product_missing");
  }
  return search.results.length;
}

export function validateDoctorContract(payload, expectedRuntime) {
  const checkKeys = ["deployment_mode", "agent_core_status", "expected_mode", "credential_isolated", "writes_disabled"];
  if (!exactKeys(payload, ["contract", "ok", "runtime", "checks"])
    || payload.contract !== "reference-store-runtime-doctor/v1" || payload.ok !== true
    || !exactKeys(payload.checks, checkKeys) || !checkKeys.every((key) => payload.checks[key] === true)) {
    fail("live_doctor_failed");
  }
  validateRuntimeContract(payload.runtime);
  assertRuntimeInvariants(payload.runtime, expectedRuntime);
  assertNoCredentialFields(payload);
  return payload;
}

export function validateRunContract(payload, expectedHandle, previewOrigin, expectedRuntime) {
  if (!exactKeys(payload, ["contract", "runtime", "search"])
    || payload.contract !== "reference-store-read-run/v1") fail("invalid_live_run_contract");
  validateRuntimeContract(payload.runtime);
  assertRuntimeInvariants(payload.runtime, expectedRuntime);
  const resultCount = validateSearch(payload.search, expectedHandle, previewOrigin);
  assertNoCredentialFields(payload);
  return resultCount;
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
    browser_persistent_storage_hits: 0,
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
  const journeys = {};
  const safety = initialSafety();
  const observed = { synthetic_fallback_count: 0, successful_commerce_write_count: 0 };
  let failureCode = null;
  let firstFailureCaseId = null;
  let observedComponents = null;
  let observedRuntime = null;
  let attestedDescriptorSha256 = null;
  try {
    const status = await transport.status();
    Object.assign(observed, observedBoundaryViolations(status));
    observedRuntime = validateRuntimeContract(status);
    observedComponents = observedRuntime.components;
    assertExpectedComponents(observedComponents, config.components);
    attestedDescriptorSha256 = assertSignedDeployment(observedRuntime, config);
    const doctor = await transport.doctor();
    const doctorViolations = observedBoundaryViolations(doctor);
    observed.synthetic_fallback_count += doctorViolations.synthetic_fallback_count;
    observed.successful_commerce_write_count += doctorViolations.successful_commerce_write_count;
    validateDoctorContract(doctor, observedRuntime);
    assertExpectedComponents(doctor.runtime.components, config.components);
    assertSignedDeployment(doctor.runtime, config);
    for (const item of config.cases) {
      const started = now();
      try {
        const payload = await transport.run(item.query);
        const runViolations = observedBoundaryViolations(payload);
        observed.synthetic_fallback_count += runViolations.synthetic_fallback_count;
        observed.successful_commerce_write_count += runViolations.successful_commerce_write_count;
        const resultCount = validateRunContract(
          payload, item.expected_handle, config.preview.origin, observedRuntime,
        );
        assertExpectedComponents(payload.runtime.components, config.components);
        assertSignedDeployment(payload.runtime, config);
        journeys[item.case_id] = Object.freeze({
          status: "passed",
          result_count: resultCount,
          latency_ms: Math.max(0, Math.round(now() - started)),
        });
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
  const passed = !failureCode && Object.keys(journeys).length === 10 && networkIsClean(safety);
  if (!passed && !failureCode) failureCode = "incomplete_live_gate";
  return Object.freeze({
    schema_version: RECEIPT_SCHEMA,
    generated_at: new Date().toISOString(),
    gate_status: passed ? "passed" : "failed",
    claim_scope: "real_unpublished_shopify_app_proxy_read_only",
    expected_components: config.components,
    observed_components: observedComponents,
    deployment_attestation: Object.freeze({
      verified: Boolean(attestedDescriptorSha256),
      signing_key_id: config.deploymentSigner.keyId,
      public_key_sha256: config.deploymentSigner.publicKeySha256,
      descriptor_sha256: attestedDescriptorSha256,
    }),
    shopify: Object.freeze({
      permanent_shop_domain_sha256: sha256(config.preview.shopDomain),
      storefront_origin_sha256: sha256(config.preview.origin),
      unpublished_theme_id: config.preview.themeId,
    }),
    inputs: Object.freeze({ cases_sha256: config.casesSha256, case_count: 10 }),
    execution: Object.freeze({
      browser: config.browser,
      attempted_count: Object.keys(journeys).length + (firstFailureCaseId ? 1 : 0),
      passed_count: Object.keys(journeys).length,
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

export function observeBrowserRequest(config, counters, observation) {
  let url;
  try { url = new URL(observation.url); } catch { counters.unexpected_api_requests += 1; return; }
  const pathname = url.pathname;
  const resourceType = String(observation.resourceType || "");
  const method = String(observation.method || "GET").toUpperCase();
  const apiPath = pathname.startsWith(`${RUNTIME_PREFIX}/`)
    || pathname.startsWith("/api/") || pathname.includes("/api/");
  if (url.origin !== config.preview.origin) {
    const passiveStatic = PASSIVE_CROSS_ORIGIN_RESOURCE_TYPES.has(resourceType)
      && ["GET", "HEAD"].includes(method) && url.protocol === "https:"
      && SHOPIFY_STATIC_HOSTS.has(url.hostname.toLowerCase());
    if (!passiveStatic || apiPath) counters.cross_origin_api_requests += 1;
    const rawQueries = Array.isArray(observation.rawQueries) ? observation.rawQueries : [];
    if (rawQueries.some((query) => url.href.includes(query) || url.href.includes(encodeURIComponent(query)))) {
      counters.cross_origin_api_requests += 1;
    }
  }
  if (LEGACY_PATHS.has(pathname) || [...LEGACY_PATHS].some((legacy) => pathname.endsWith(legacy))) {
    counters.legacy_route_requests += 1;
  }
  const expectedMethod = RUNTIME_ROUTES.get(pathname);
  if (apiPath && (url.origin !== config.preview.origin
    || !expectedMethod || expectedMethod !== method || url.search)) {
    counters.unexpected_api_requests += 1;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)
    && !(url.origin === config.preview.origin
      && pathname === `${RUNTIME_PREFIX}/api/runs` && method === "POST" && !url.search)) {
    counters.browser_write_requests += 1;
  }
  const headerNames = (observation.headerNames || []).map((name) => String(name).toLowerCase());
  if (headerNames.some((name) => FORBIDDEN_BROWSER_HEADERS.has(name))) {
    counters.forbidden_browser_header_requests += 1;
  }
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
  const issuedQueries = [];
  page.on("console", (message) => { if (message.type() === "error") counters.console_errors += 1; });
  page.on("pageerror", () => { counters.page_errors += 1; });
  page.on("request", (request) => {
    observeBrowserRequest(config, counters, {
      url: request.url(), method: request.method(), resourceType: request.resourceType(),
      headerNames: Object.keys(request.headers()), rawQueries: issuedQueries,
    });
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
    run: (query) => {
      issuedQueries.push(query);
      return jsonFetch(page, `${RUNTIME_PREFIX}/api/runs`, { query, limit: 20 });
    },
    safety: async (queries) => {
      const storage = await page.evaluate(async (rawQueries) => {
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
        let persistentHits = 0;
        try {
          if (typeof indexedDB?.databases !== "function") persistentHits += 1;
          else persistentHits += (await indexedDB.databases()).length;
        } catch { persistentHits += 1; }
        try {
          if (typeof caches?.keys !== "function") persistentHits += 1;
          else persistentHits += (await caches.keys()).length;
        } catch { persistentHits += 1; }
        try {
          if (!navigator.serviceWorker || typeof navigator.serviceWorker.getRegistrations !== "function") {
            persistentHits += 1;
          } else persistentHits += (await navigator.serviceWorker.getRegistrations()).length;
        } catch { persistentHits += 1; }
        return { credentialHits, queryHits, persistentHits };
      }, queries);
      let cookieCredentialHits = 0;
      let cookieQueryHits = 0;
      const forbidden = /(?:access[_-]?token|authorization|client[_-]?secret|credential|hmac|password|signature|x-sandbox-invite)/iu;
      for (const cookie of await context.cookies()) {
        if (forbidden.test(cookie.name) || forbidden.test(cookie.value)) cookieCredentialHits += 1;
        if (queries.some((query) => cookie.name.includes(query) || cookie.value.includes(query))) {
          cookieQueryHits += 1;
        }
      }
      return {
        ...counters,
        browser_storage_credential_hits: storage.credentialHits + cookieCredentialHits,
        browser_storage_query_hits: storage.queryHits + cookieQueryHits,
        browser_persistent_storage_hits: storage.persistentHits,
      };
    },
    close: async () => {
      await context.close();
      await browser.close();
    },
  });
}

export function validateReceiptShape(receipt, config = null) {
  const topKeys = [
    "schema_version", "generated_at", "gate_status", "claim_scope", "expected_components",
    "observed_components", "deployment_attestation", "shopify", "inputs", "execution", "safety",
    "boundaries", "journeys",
  ];
  const executionKeys = [
    "browser", "attempted_count", "passed_count", "failed_count", "first_failure_case_id", "failure_code",
  ];
  if (!exactKeys(receipt, topKeys) || receipt.schema_version !== RECEIPT_SCHEMA
    || !exactIsoTimestamp(receipt.generated_at) || !["passed", "failed"].includes(receipt.gate_status)
    || receipt.claim_scope !== "real_unpublished_shopify_app_proxy_read_only"
    || !validComponentIdentities(receipt.expected_components)
    || !(receipt.observed_components === null || validComponentIdentities(receipt.observed_components))
    || !exactKeys(receipt.deployment_attestation, RECEIPT_ATTESTATION_KEYS)
    || typeof receipt.deployment_attestation.verified !== "boolean"
    || !SAFE_IDENTIFIER.test(receipt.deployment_attestation.signing_key_id)
    || !DIGEST.test(receipt.deployment_attestation.public_key_sha256)
    || !(receipt.deployment_attestation.descriptor_sha256 === null
      || DIGEST.test(receipt.deployment_attestation.descriptor_sha256))
    || receipt.deployment_attestation.verified
      !== Boolean(receipt.deployment_attestation.descriptor_sha256)
    || !exactKeys(receipt.shopify, [
      "permanent_shop_domain_sha256", "storefront_origin_sha256", "unpublished_theme_id",
    ])
    || !DIGEST.test(receipt.shopify.permanent_shop_domain_sha256)
    || !DIGEST.test(receipt.shopify.storefront_origin_sha256)
    || !/^\d{6,20}$/u.test(receipt.shopify.unpublished_theme_id)
    || !exactKeys(receipt.inputs, ["cases_sha256", "case_count"])
    || !DIGEST.test(receipt.inputs.cases_sha256) || receipt.inputs.case_count !== 10
    || !exactKeys(receipt.execution, executionKeys)
    || !["chromium", "firefox", "webkit"].includes(receipt.execution.browser)
    || !["attempted_count", "passed_count", "failed_count"]
      .every((key) => nonnegativeInteger(receipt.execution[key]))
    || receipt.execution.attempted_count > 10 || receipt.execution.passed_count > 10
    || receipt.execution.failed_count > 1
    || !(receipt.execution.first_failure_case_id === null
      || CASE_ID.test(receipt.execution.first_failure_case_id))
    || !(receipt.execution.failure_code === null
      || /^[a-z0-9_]{3,80}$/u.test(receipt.execution.failure_code))
    || !exactKeys(receipt.safety, SAFETY_KEYS)
    || !SAFETY_KEYS.every((key) => nonnegativeInteger(receipt.safety[key]))
    || !exactKeys(receipt.boundaries, RECEIPT_BOUNDARY_KEYS)
    || !["actual_shopify_app_proxy_verified", "live_shopify_connection_verified"]
      .every((key) => typeof receipt.boundaries[key] === "boolean")
    || !RECEIPT_BOUNDARY_KEYS.slice(2)
      .every((key) => nonnegativeInteger(receipt.boundaries[key]))
    || !["raw_query_record_count", "raw_response_record_count", "cookie_record_count", "signature_record_count", "token_record_count"]
      .every((key) => receipt.boundaries[key] === 0)
    || !receipt.journeys || typeof receipt.journeys !== "object" || Array.isArray(receipt.journeys)
    || Object.keys(receipt.journeys).length > 10) fail("invalid_receipt_shape");
  const journeyCaseIds = Object.keys(receipt.journeys);
  for (const [caseId, journey] of Object.entries(receipt.journeys)) {
    if (!CASE_ID.test(caseId) || !exactKeys(journey, ["status", "result_count", "latency_ms"])
      || journey.status !== "passed"
      || !Number.isInteger(journey.result_count) || journey.result_count < 1 || journey.result_count > 20
      || !nonnegativeInteger(journey.latency_ms) || journey.latency_ms > 120_000) {
      fail("invalid_receipt_shape");
    }
  }
  if (receipt.execution.passed_count !== journeyCaseIds.length
    || receipt.execution.attempted_count
      !== receipt.execution.passed_count + receipt.execution.failed_count
    || Boolean(receipt.execution.first_failure_case_id) !== Boolean(receipt.execution.failed_count)) {
    fail("invalid_receipt_shape");
  }
  const passed = receipt.gate_status === "passed";
  if (passed) {
    if (journeyCaseIds.length !== 10
      || receipt.execution.attempted_count !== 10 || receipt.execution.passed_count !== 10
      || receipt.execution.failed_count !== 0 || receipt.execution.first_failure_case_id !== null
      || receipt.execution.failure_code !== null || receipt.observed_components === null
      || !exactCanonicalValue(receipt.observed_components, receipt.expected_components)
      || receipt.deployment_attestation.verified !== true
      || receipt.deployment_attestation.descriptor_sha256
        !== sha256(canonicalJson(deploymentDescriptor(receipt.expected_components)))
      || !SAFETY_KEYS.every((key) => receipt.safety[key] === 0)
      || receipt.boundaries.actual_shopify_app_proxy_verified !== true
      || receipt.boundaries.live_shopify_connection_verified !== true
      || !RECEIPT_BOUNDARY_KEYS.slice(2).every((key) => receipt.boundaries[key] === 0)) {
      fail("invalid_receipt_shape");
    }
  } else if (receipt.execution.failure_code === null
    || receipt.boundaries.actual_shopify_app_proxy_verified !== false
    || receipt.boundaries.live_shopify_connection_verified !== false) {
    fail("invalid_receipt_shape");
  }
  if (config) {
    const expectedCaseIds = new Set(config.cases.map((item) => item.case_id));
    if (!exactCanonicalValue(receipt.expected_components, config.components)
      || receipt.deployment_attestation.signing_key_id !== config.deploymentSigner.keyId
      || receipt.deployment_attestation.public_key_sha256 !== config.deploymentSigner.publicKeySha256
      || receipt.shopify.permanent_shop_domain_sha256 !== sha256(config.preview.shopDomain)
      || receipt.shopify.storefront_origin_sha256 !== sha256(config.preview.origin)
      || receipt.shopify.unpublished_theme_id !== config.preview.themeId
      || receipt.inputs.cases_sha256 !== config.casesSha256
      || receipt.execution.browser !== config.browser
      || journeyCaseIds.some((caseId) => !expectedCaseIds.has(caseId))) {
      fail("receipt_input_identity_mismatch");
    }
  }
  return receipt;
}

export function validateManifestShape(manifest, { receiptBytes, receiptDigest, casesSha256 }) {
  if (!exactKeys(manifest, [
    "schema_version", "generated_at", "receipt_file", "receipt_bytes", "receipt_sha256", "cases_sha256",
  ]) || manifest.schema_version !== MANIFEST_SCHEMA || !exactIsoTimestamp(manifest.generated_at)
    || manifest.receipt_file !== "receipt.json" || !Number.isInteger(manifest.receipt_bytes)
    || manifest.receipt_bytes <= 0 || manifest.receipt_bytes !== receiptBytes
    || !DIGEST.test(manifest.receipt_sha256) || manifest.receipt_sha256 !== receiptDigest
    || !DIGEST.test(manifest.cases_sha256) || manifest.cases_sha256 !== casesSha256) {
    fail("invalid_evidence_manifest");
  }
  return manifest;
}

export async function writeEvidence(config, receipt) {
  validateReceiptShape(receipt, config);
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
  validateManifestShape(manifest, {
    receiptBytes: receiptBytes.length,
    receiptDigest,
    casesSha256: config.casesSha256,
  });
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
