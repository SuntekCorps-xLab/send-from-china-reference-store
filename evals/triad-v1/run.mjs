import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

import storefrontBff from "../../storefront-bff/src/index.js";
import { startDemo } from "../../demo/server.mjs";
import { loadStartSandbox } from "../../scripts/demo-platform.mjs";
import { EXPECTED_AGENT_CORE_SHA, EXPECTED_MINI_SHA, loadDataset } from "./dataset.mjs";

export const ARTIFACT_SCHEMA_VERSION = "send-from-china-triad-contract-projection-artifact/v2";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOOPBACK_HOSTS = new Set(["localhost", "[::1]", "127.0.0.1"]);
const STOREFRONT_ORIGIN = "https://sandbox-store.example.invalid";
const COMMERCE_PATH = /\/(?:cart|carts|checkout|checkouts|order|orders|payment|payments|product|products|sourcing)(?:\/|$)/iu;
const SHA = /^[0-9a-f]{40}$/u;

export const FIXTURE_QUERIES = Object.freeze({
  desk_organizer: "desk organizer",
  compact_desk_organizer: "compact desk organizer",
  modular_desk_organizer: "modular desk organizer",
  desk_organizer_tray: "desk organizer tray",
  organizer_for_desk: "organizer for desk",
  desk_cable_organizer: "desk cable organizer",
  desktop_organizer: "desktop organizer",
  office_desk_organizer: "office desk organizer",
  practical_desk_organizer: "practical desk organizer",
  small_desk_organizer: "small desk organizer",
  quartz_violin_umbrella: "quartz violin umbrella",
  lunar_teapot_violin: "lunar teapot violin",
  amber_submarine_violin: "amber submarine violin",
  ceramic_rocket_violin: "ceramic rocket violin",
  marble_telescope_umbrella: "marble telescope umbrella",
  velvet_compass_kettle: "velvet compass kettle",
  crystal_canoe_trumpet: "crystal canoe trumpet",
  bronze_hammock_saxophone: "bronze hammock saxophone",
  granite_balloon_cello: "granite balloon cello",
  silver_cactus_trombone: "silver cactus trombone",
});

function normalizePath(value) {
  const normalized = path.resolve(value).replace(/\\/gu, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function gitEnvironment() {
  const env = { ...process.env };
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_CONFIG",
    "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM",
  ]) delete env[name];
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

function gitProcess(directory, args, options = {}) {
  const result = spawnSync("git", [
    "--no-replace-objects",
    "-c", `safe.directory=${directory}`,
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "core.ignorestat=false",
    "-c", "core.trustctime=true",
    "-C", directory,
    ...args,
  ], {
    encoding: "utf8",
    env: gitEnvironment(),
    input: options.input,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("repository provenance unavailable");
  return result;
}

function git(directory, args) {
  const result = gitProcess(directory, args);
  return String(result.stdout || "").trim();
}

function verifyWorkingTreeBlobs(directory, commit, label) {
  const records = git(directory, ["ls-tree", "-r", "-z", "--full-tree", commit])
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const match = /^([0-7]{6}) blob ([0-9a-f]{40})\t(.+)$/u.exec(record);
      if (!match || !["100644", "100755"].includes(match[1]) || /[\r\n]/u.test(match[3])) {
        throw new Error(`${label} contains an unsupported tracked entry`);
      }
      return { expected: match[2], file: match[3] };
    });
  if (!records.length) throw new Error(`${label} contains no tracked source closure`);
  const result = gitProcess(directory, ["hash-object", "--stdin-paths"], {
    input: `${records.map((record) => record.file).join("\n")}\n`,
  });
  const actual = String(result.stdout || "").trim().split(/\r?\n/u).filter(Boolean);
  if (actual.length !== records.length
    || records.some((record, index) => actual[index] !== record.expected)) {
    throw new Error(`${label} working files do not match the no-replace commit tree`);
  }
}

export async function repositoryDescriptor(directory, expectedCommit, label) {
  if (expectedCommit !== undefined && !SHA.test(expectedCommit)) {
    throw new Error(`${label} expected commit must be an exact lowercase SHA`);
  }
  const requested = path.resolve(directory);
  const entry = await lstat(requested);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`${label} checkout must be a real directory`);
  const canonical = await realpath(requested);
  const topLevel = git(canonical, ["rev-parse", "--show-toplevel"]);
  if (normalizePath(topLevel) !== normalizePath(canonical)) throw new Error(`${label} path must be the repository root`);
  if (git(canonical, ["for-each-ref", "--format=%(refname)", "refs/replace"])) {
    throw new Error(`${label} checkout must not contain Git replacement refs`);
  }
  const commonDirectoryValue = git(canonical, ["rev-parse", "--git-common-dir"]);
  const commonDirectory = path.isAbsolute(commonDirectoryValue)
    ? commonDirectoryValue
    : path.resolve(canonical, commonDirectoryValue);
  try {
    await lstat(path.join(commonDirectory, "info", "grafts"));
    throw new Error(`${label} checkout must not contain a Git grafts file`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const commit = git(canonical, ["rev-parse", "HEAD"]);
  if (!SHA.test(commit)) throw new Error(`${label} commit is invalid`);
  if (expectedCommit !== undefined && commit !== expectedCommit) throw new Error(`${label} checkout does not match its explicit SHA`);
  git(canonical, ["cat-file", "-e", `${commit}^{commit}`]);
  const trackedEntries = git(canonical, ["ls-files", "-v", "-z"])
    .split("\0")
    .filter(Boolean);
  if (!trackedEntries.length || trackedEntries.some((entry) => entry[0] !== "H" || entry[1] !== " ")) {
    throw new Error(`${label} checkout uses unsupported index flags or tracked states`);
  }
  if (git(canonical, ["status", "--porcelain", "--untracked-files=normal"])) {
    throw new Error(`${label} checkout must be clean`);
  }
  verifyWorkingTreeBlobs(canonical, commit, label);
  return { directory: canonical, commit };
}

function argumentMap(args) {
  const allowed = new Set([
    "--mini",
    "--mini-sha",
    "--agent-core",
    "--agent-core-sha",
    "--reference-store-sha",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    let name = args[index];
    let value = "";
    const separator = name.indexOf("=");
    if (separator >= 0) {
      value = name.slice(separator + 1);
      name = name.slice(0, separator);
    } else {
      value = args[index + 1] || "";
      index += 1;
    }
    if (!allowed.has(name) || !value || value.startsWith("--") || values.has(name)) {
      throw new TypeError("triad CLI arguments are invalid or incomplete");
    }
    values.set(name, value);
  }
  if (values.size !== allowed.size || [...allowed].some((name) => !values.has(name))) {
    throw new TypeError("--mini, --mini-sha, --agent-core, --agent-core-sha, --reference-store-sha, and --output are required");
  }
  return values;
}

function rejectTraversal(value, label) {
  if (String(value).split(/[\\/]+/u).includes("..")) throw new TypeError(`${label} must not contain path traversal`);
}

export function parseArguments(args, cwd = process.cwd()) {
  const values = argumentMap(args);
  const miniSha = values.get("--mini-sha");
  const agentCoreSha = values.get("--agent-core-sha");
  const referenceStoreSha = values.get("--reference-store-sha");
  if (![miniSha, agentCoreSha, referenceStoreSha].every((value) => SHA.test(value))) {
    throw new TypeError("repository SHAs must be exact lowercase commits");
  }
  if (miniSha !== EXPECTED_MINI_SHA || agentCoreSha !== EXPECTED_AGENT_CORE_SHA) {
    throw new TypeError("Mini and Agent Core SHAs must match the reviewed contract locks");
  }
  const outputValue = values.get("--output");
  rejectTraversal(outputValue, "--output");
  if (!path.isAbsolute(outputValue)) throw new TypeError("--output must be an absolute repository-external path");
  return {
    miniDirectory: path.resolve(cwd, values.get("--mini")),
    miniSha,
    agentCoreDirectory: path.resolve(cwd, values.get("--agent-core")),
    agentCoreSha,
    referenceStoreSha,
    output: path.resolve(outputValue),
  };
}

function requestUrl(input) {
  if (input instanceof Request) return new URL(input.url);
  if (input instanceof URL) return input;
  return new URL(String(input));
}

function loopback(url) {
  return (url.protocol === "http:" || url.protocol === "https:")
    && LOOPBACK_HOSTS.has(url.hostname)
    && !url.username
    && !url.password;
}

function endpointKey(method, url) {
  if (url.hash) throw new Error("network allowlist endpoints must not contain fragments");
  return `${String(method).toUpperCase()} ${url.href}`;
}

export function installNetworkGuard(nativeFetch = globalThis.fetch) {
  const counts = {
    allowed: 0,
    nonLoopback: 0,
    commerceWrites: 0,
    deniedEndpoints: 0,
    redirects: 0,
  };
  const endpoints = new Set();
  const allowEndpoint = (method, value) => {
    const url = requestUrl(value);
    if (!loopback(url)) throw new Error("network allowlist endpoint must be loopback");
    endpoints.add(endpointKey(method, url));
  };
  const guardedFetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = String(init.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    if (!loopback(url)) {
      counts.nonLoopback += 1;
      throw new Error("contract projection blocked a non-loopback request");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && COMMERCE_PATH.test(url.pathname)) {
      counts.commerceWrites += 1;
      throw new Error("contract projection blocked a commerce write route");
    }
    if (!endpoints.has(endpointKey(method, url))) {
      counts.deniedEndpoints += 1;
      throw new Error("contract projection blocked an endpoint outside the exact loopback allowlist");
    }
    const response = await nativeFetch(input, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      counts.redirects += 1;
      throw new Error("contract projection blocked a redirect response");
    }
    counts.allowed += 1;
    return response;
  };
  const previous = globalThis.fetch;
  globalThis.fetch = guardedFetch;
  return {
    counts,
    allowEndpoint,
    restore() { globalThis.fetch = previous; },
  };
}

async function startGuardedPlatform(startSandbox, network) {
  let sandbox;
  let demo;
  try {
    sandbox = await startSandbox({ port: 0, host: "127.0.0.1", quiet: true });
    if (!sandbox || typeof sandbox.baseUrl !== "string" || typeof sandbox.token !== "string" || !sandbox.token) {
      throw new Error("Agent Core returned an invalid synthetic runtime");
    }
    network.allowEndpoint("GET", `${sandbox.baseUrl}/sandbox/status`);
    network.allowEndpoint("GET", `${sandbox.baseUrl}/api/search?q=sandbox-readiness&limit=1`);
    network.allowEndpoint("POST", `${sandbox.baseUrl}/api/search/v2`);
    network.allowEndpoint("POST", `${sandbox.baseUrl}/sandbox/api/search/v2`);
    demo = await startDemo({
      mode: "connected",
      port: 0,
      host: "127.0.0.1",
      quiet: true,
      verifyConnected: true,
      agentCoreBaseUrl: sandbox.baseUrl,
      agentCoreToken: sandbox.token,
      storefrontOrigin: STOREFRONT_ORIGIN,
    });
    network.allowEndpoint("GET", `${demo.baseUrl}/api/status`);
    network.allowEndpoint("POST", `${demo.baseUrl}/api/search`);
    return {
      sandbox,
      demo,
      async close() {
        await demo?.close().catch(() => {});
        await sandbox?.close().catch(() => {});
      },
    };
  } catch (error) {
    await demo?.close().catch(() => {});
    await sandbox?.close().catch(() => {});
    throw error;
  }
}

function fakeElement() {
  return {
    checked: false,
    disabled: false,
    hidden: false,
    innerHTML: "",
    textContent: "",
    value: "",
    handlers: new Map(),
    addEventListener(name, handler) { this.handlers.set(name, handler); },
  };
}

export function createMiniClientAdapter(source) {
  if (typeof source !== "string" || source.length < 500) throw new TypeError("Mini client source is unavailable");
  const input = fakeElement();
  input.value = "desk organizer";
  const results = fakeElement();
  const title = fakeElement();
  const sourcing = fakeElement();
  const confirm = fakeElement();
  const sourceButton = fakeElement();
  const request = fakeElement();
  const searchButton = fakeElement();
  const stages = Array.from({ length: 4 }, () => {
    const icon = fakeElement();
    return { className: "", querySelector: (selector) => selector === "i" ? icon : null };
  });
  const timeline = { querySelectorAll: (selector) => selector === "span" ? stages : [] };
  const selectors = new Map([
    ["#query", input],
    ["[data-results]", results],
    ["[data-result-title]", title],
    ["[data-sourcing]", sourcing],
    ["[data-confirm]", confirm],
    ["[data-source]", sourceButton],
    ["[data-request]", request],
    ["[data-timeline]", timeline],
    ["[data-search]", searchButton],
  ]);
  const document = {
    querySelector: (selector) => selectors.get(selector) || null,
    querySelectorAll: (selector) => selector === "[data-suggestion]" ? [] : [],
  };
  vm.runInNewContext(source, { document }, { timeout: 500, displayErrors: false });
  const click = searchButton.handlers.get("click");
  if (typeof click !== "function") throw new TypeError("Mini client search adapter is not callable");

  return {
    search(query) {
      input.value = String(query);
      click();
      const requestContract = JSON.parse(request.textContent);
      const resultCount = (results.innerHTML.match(/<article class="product-card">/gu) || []).length;
      const illustrativeCount = (results.innerHTML.match(/ILLUSTRATIVE MATCH/gu) || []).length;
      const noPurchaseCount = (results.innerHTML.match(/NO PURCHASE URL/gu) || []).length;
      const status = title.textContent === "Catalog match" ? "results"
        : title.textContent === "No catalog match" ? "no_match" : "unknown";
      return {
        status,
        result_count: resultCount,
        illustrative_count: illustrativeCount,
        no_purchase_count: noPurchaseCount,
        request_contract: requestContract,
      };
    },
  };
}

function verifier() {
  let count = 0;
  return {
    get count() { return count; },
    equal(actual, expected, message) { count += 1; assert.equal(actual, expected, message); },
    deepEqual(actual, expected, message) { count += 1; assert.deepEqual(actual, expected, message); },
    ok(value, message) { count += 1; assert.ok(value, message); },
  };
}

function searchContract(query, limit) {
  return {
    contract_version: "2.0",
    product_identity: {
      name: "product_identity",
      value: query,
      source: "explicit",
      scope: "product",
      hardness: "hard",
    },
    hard_constraints: [],
    soft_context: [],
    transaction_context: [],
    limit,
    cursor: null,
  };
}

async function readJson(response) {
  return { response, body: JSON.parse(await response.text()) };
}

async function coreSearch(state, query, limit) {
  return readJson(await fetch(`${state.platform.sandbox.baseUrl}/sandbox/api/search/v2`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(searchContract(query, limit)),
  }));
}

async function bffSearch(state, query, limit) {
  const response = await storefrontBff.fetch(new Request("https://local-bff.example.invalid/api/search", {
    method: "POST",
    headers: { "content-type": "application/json", origin: STOREFRONT_ORIGIN },
    body: JSON.stringify({ search_contract: searchContract(query, limit) }),
  }), state.bffEnv);
  return readJson(response);
}

async function demoSearch(state, query, limit) {
  return readJson(await fetch(`${state.platform.demo.baseUrl}/api/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ search_contract: searchContract(query, limit) }),
  }));
}

async function validatePlatformRuntime(platform, check) {
  const [coreStatus, demoStatus] = await Promise.all([
    readJson(await fetch(`${platform.sandbox.baseUrl}/sandbox/status`)),
    readJson(await fetch(`${platform.demo.baseUrl}/api/status`)),
  ]);
  check.equal(coreStatus.response.status, 200, "Agent Core sandbox status must be reachable on loopback");
  check.equal(coreStatus.body.mode, "synthetic_local_sandbox", "Agent Core must attest synthetic sandbox mode");
  check.equal(coreStatus.body.data_source, "synthetic_fixture", "Agent Core must attest synthetic fixture provenance");
  check.equal(coreStatus.body.commerce_writes, false, "Agent Core sandbox must disable commerce writes");
  check.equal(demoStatus.response.status, 200, "Reference Store status must be reachable on loopback");
  check.equal(demoStatus.body.mode, "connected_local_sandbox", "Reference Store must attest connected sandbox mode");
  check.equal(demoStatus.body.synthetic, true, "Reference Store must attest synthetic provenance");
  check.equal(demoStatus.body.commerce_writes, false, "Reference Store must disable commerce writes");
}

function products(payload) {
  return Array.isArray(payload?.results) ? payload.results : [];
}

function productTitles(payload) {
  return products(payload).map((product) => String(product?.title || ""));
}

function productIdentities(payload) {
  return products(payload).map((product) => ({
    public_id: String(product?.public_id || ""),
    title: String(product?.title || ""),
  }));
}

function countUnattestedRecords(payload) {
  return products(payload).filter((product) => !(
    product?.illustrative_only === true
    || product?.illustrative === true
    || product?.synthetic === true
    || product?.availability_band === "demo_only"
  ) || product?.purchasable === true || product?.available === true).length;
}

async function loadMiniRuntime(mini, check, network) {
  const moduleUrl = `${pathToFileURL(path.join(mini.directory, "scripts", "serve.mjs")).href}?triad=${mini.commit}`;
  const { startStaticServer } = await import(moduleUrl);
  const runtime = await startStaticServer({ host: "127.0.0.1", port: 0 });
  try {
    network.allowEndpoint("GET", `${runtime.origin}/demo/demo.js`);
    network.allowEndpoint("GET", `${runtime.origin}/data/synthetic-v0/journeys.json`);
    network.allowEndpoint("GET", `${runtime.origin}/.well-known/send-from-china.json`);
    const [scriptResponse, datasetResponse, discoveryResponse] = await Promise.all([
      fetch(`${runtime.origin}/demo/demo.js`),
      fetch(`${runtime.origin}/data/synthetic-v0/journeys.json`),
      fetch(`${runtime.origin}/.well-known/send-from-china.json`),
    ]);
    check.equal(scriptResponse.status, 200, "Mini client adapter must load from its loopback runtime");
    check.equal(datasetResponse.status, 200, "Mini synthetic dataset must load from its loopback runtime");
    check.equal(discoveryResponse.status, 200, "Mini discovery must load from its loopback runtime");
    const [source, dataset, discovery] = await Promise.all([
      scriptResponse.text(),
      datasetResponse.json(),
      discoveryResponse.json(),
    ]);
    check.equal(dataset.provenance, "synthetic", "Mini data provenance must be synthetic");
    check.equal(dataset.record_count, 50, "Mini synthetic dataset size must remain explicit");
    check.equal(dataset.capability_boundaries?.purchasable, false, "Mini fixtures must be non-purchasable");
    check.equal(dataset.capability_boundaries?.production_writes, false, "Mini fixtures must expose no production write");
    check.equal(discovery.telemetry?.synthetic_external_calls, false, "Mini synthetic mode must declare zero external calls");
    check.equal(discovery.live_preview?.publicly_activated, false, "Mini live preview must remain inactive");
    check.equal(discovery.live_preview?.writes, false, "Mini live preview must remain read-only");
    return { ...runtime, adapter: createMiniClientAdapter(source) };
  } catch (error) {
    await runtime.close().catch(() => {});
    throw error;
  }
}

async function runJourney(state, journey, counters, check) {
  const query = FIXTURE_QUERIES[journey.fixture];
  check.ok(query, "fixture must resolve to a deterministic local query");

  const mini = state.mini.adapter.search(query);
  check.equal(mini.request_contract.mode, "online_synthetic_preview", "Mini request must remain synthetic");
  check.equal(mini.request_contract.external_call, false, "Mini request must not perform an external call");
  check.equal(mini.request_contract.product_identity, query, "Mini must preserve the normalized fixture query");

  const [core, bff, demo] = await Promise.all([
    coreSearch(state, query, journey.limit),
    bffSearch(state, query, journey.limit),
    demoSearch(state, query, journey.limit),
  ]);
  for (const surface of [core, bff, demo]) check.equal(surface.response.status, 200, "all synthetic surfaces must succeed");
  check.equal(mini.status, journey.expected_status, "Mini status must match the journey contract");
  check.equal(core.body.status, journey.expected_status, "Agent Core status must match the journey contract");
  check.equal(bff.body.status, journey.expected_status, "Reference BFF status must match Agent Core");
  check.equal(demo.body.status, journey.expected_status, "Reference loopback demo status must match Agent Core");

  const expectsResults = journey.expected_status === "results";
  for (const count of [mini.result_count, products(core.body).length, products(bff.body).length, products(demo.body).length]) {
    check.equal(count > 0, expectsResults, "all three repositories must agree on result presence");
  }
  check.equal(mini.illustrative_count, mini.result_count, "every Mini result must be illustrative");
  check.equal(mini.no_purchase_count, mini.result_count, "every Mini result must omit a purchase URL");
  check.deepEqual(productTitles(bff.body), productTitles(core.body), "BFF result titles must preserve the Core result set");
  check.deepEqual(productTitles(demo.body), productTitles(core.body), "loopback demo result titles must preserve the Core result set");
  check.deepEqual(productIdentities(bff.body), productIdentities(core.body), "BFF results must preserve the synthetic Core identities");
  check.deepEqual(productIdentities(demo.body), productIdentities(core.body), "loopback demo results must preserve the synthetic Core identities");
  for (const product of products(bff.body)) {
    check.equal(product.available, false, "BFF must not infer live availability");
    check.equal(product.product_url, "", "BFF must not expose unverified product evidence");
    check.equal(product.add_to_cart_url, "", "BFF must not expose add-to-cart evidence");
    check.equal(product.purchase_handoff, null, "BFF must not expose a purchase handoff");
  }
  check.equal(demo.body.mode, "connected_local_sandbox", "Reference demo must remain in its connected synthetic mode");
  check.equal(demo.body.boundaries?.commerce_writes, false, "Reference demo must keep commerce writes disabled");

  // BFF identities are counted as synthetic only after the exact in-memory
  // identity comparison above. Core and browser-demo records must also carry
  // their own explicit synthetic/illustrative attestation.
  const productionRecords = [core.body, demo.body].reduce(
    (total, payload) => total + countUnattestedRecords(payload),
    0,
  );
  counters.productionRecords += productionRecords;
  check.equal(productionRecords, 0, "no synthetic surface may return a production record");
}

export function createArtifact({ repositories, journeyCount, attemptedCount, passedCount, assertionCount, firstFailureOrdinal, network, productionRecords }) {
  const failedCount = attemptedCount - passedCount;
  const safe = failedCount === 0
    && attemptedCount === journeyCount
    && network.nonLoopback === 0
    && network.commerceWrites === 0
    && network.deniedEndpoints === 0
    && network.redirects === 0
    && productionRecords === 0;
  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    claim_scope: "synthetic_contract_projection",
    full_triad_e2e: false,
    authorizes_release: false,
    authorizes_live_preview: false,
    observation_scope: "global_fetch_only",
    non_fetch_network_observation: "not_observed",
    vm_execution_boundary: "trusted_pinned_mini_source_not_security_sandbox",
    repositories: {
      mini_suntek: repositories.mini_suntek.commit,
      agent_core: repositories.agent_core.commit,
      reference_store: repositories.reference_store.commit,
    },
    aggregate: {
      status: safe ? "contract_passed" : "contract_failed",
      journey_count: journeyCount,
      attempted_count: attemptedCount,
      passed_count: passedCount,
      failed_count: failedCount,
      assertion_count: assertionCount,
      first_failure_ordinal: firstFailureOrdinal,
      guarded_fetch_allowed_request_count: network.allowed,
      guarded_fetch_non_loopback_request_count: network.nonLoopback,
      production_record_count: productionRecords,
      guarded_fetch_commerce_write_count: network.commerceWrites,
      guarded_fetch_denied_endpoint_count: network.deniedEndpoints,
      guarded_fetch_redirect_count: network.redirects,
    },
  };
}

async function canonicalArtifactParent(targetParent) {
  const requestedParent = path.resolve(targetParent);
  const platformTemporaryBase = path.resolve(tmpdir());
  const requestedBase = isInside(platformTemporaryBase, requestedParent)
    ? platformTemporaryBase
    : path.parse(requestedParent).root;
  let requestedCurrent = requestedBase;
  let canonicalCurrent = await realpath(requestedBase);
  const relative = path.relative(requestedBase, requestedParent);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("artifact parent escaped its trusted traversal base");
  }

  // The OS temporary base is trusted and canonicalized as one unit so macOS
  // can expose it through the system /var -> /private/var alias. Every
  // requested component after that base is inspected individually. For paths
  // outside the platform temp directory, the filesystem root is the base and
  // therefore every non-root component receives the same strict inspection.
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    requestedCurrent = path.join(requestedCurrent, segment);
    canonicalCurrent = path.join(canonicalCurrent, segment);
    try {
      const entry = await lstat(requestedCurrent);
      if (entry.isSymbolicLink()) throw new Error("artifact path must not traverse a symbolic link");
      if (!entry.isDirectory()) throw new Error("artifact parent component must be a directory");
      const physical = await realpath(requestedCurrent);
      if (normalizePath(physical) !== normalizePath(canonicalCurrent)) {
        throw new Error("artifact path must not traverse a junction or reparse point");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(canonicalCurrent);
      const created = await lstat(canonicalCurrent);
      if (!created.isDirectory() || created.isSymbolicLink()) throw new Error("artifact directory creation was unsafe");
      const requestedCreated = await lstat(requestedCurrent);
      const physical = await realpath(requestedCurrent);
      if (!requestedCreated.isDirectory()
        || requestedCreated.isSymbolicLink()
        || normalizePath(physical) !== normalizePath(canonicalCurrent)) {
        throw new Error("artifact directory creation was unsafe");
      }
    }
  }
  return canonicalCurrent;
}

export async function writeArtifactNew(output, artifact, repositoryRoots) {
  const target = path.resolve(output);
  if (!path.isAbsolute(output)) throw new TypeError("artifact output must be absolute");
  rejectTraversal(output, "artifact output");
  for (const repositoryRoot of repositoryRoots) {
    if (isInside(path.resolve(repositoryRoot), target)) throw new Error("artifact output must remain outside every repository");
  }
  const canonicalParent = await canonicalArtifactParent(path.dirname(target));
  const canonicalTarget = path.join(canonicalParent, path.basename(target));
  const parentBefore = await stat(canonicalParent);
  for (const repositoryRoot of repositoryRoots) {
    const canonicalRepository = await realpath(path.resolve(repositoryRoot));
    if (isInside(canonicalRepository, canonicalTarget)) {
      throw new Error("artifact output must remain outside every canonical repository path");
    }
  }
  const bytes = `${JSON.stringify(artifact, null, 2)}\n`;
  const handle = await open(canonicalTarget, "wx", 0o600);
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const entry = await lstat(canonicalTarget);
  const metadata = await stat(canonicalTarget);
  if (!entry.isFile() || entry.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error("artifact target must be a new regular single-link file");
  }
  const physicalTarget = await realpath(canonicalTarget);
  const physicalParent = await realpath(path.dirname(physicalTarget));
  const parentAfter = await stat(physicalParent);
  if (normalizePath(physicalTarget) !== normalizePath(canonicalTarget)
    || normalizePath(physicalParent) !== normalizePath(canonicalParent)
    || parentBefore.dev !== parentAfter.dev
    || parentBefore.ino !== parentAfter.ino) {
    throw new Error("artifact parent identity changed during the write");
  }
  return canonicalTarget;
}

export async function runTriad(options) {
  const parsed = options?.args ? parseArguments(options.args, options.cwd) : options;
  const mini = await repositoryDescriptor(parsed.miniDirectory, parsed.miniSha, "Mini Suntek");
  const agentCore = await repositoryDescriptor(parsed.agentCoreDirectory, parsed.agentCoreSha, "Agent Core");
  const referenceStore = await repositoryDescriptor(root, parsed.referenceStoreSha, "Reference Store");
  const repositories = { mini_suntek: mini, agent_core: agentCore, reference_store: referenceStore };
  const { dataset } = await loadDataset();
  if (parsed.miniSha !== dataset.expected_mini_sha) {
    throw new Error("explicit Mini SHA does not match the triad contract lock");
  }
  if (parsed.agentCoreSha !== dataset.expected_agent_core_sha) {
    throw new Error("explicit Agent Core SHA does not match the triad contract lock");
  }
  if (dataset.journeys.some((journey) => !FIXTURE_QUERIES[journey.fixture])) {
    throw new Error("triad fixture map is incomplete");
  }

  const network = installNetworkGuard();
  const setupCheck = verifier();
  let miniRuntime;
  let platform;
  let attemptedCount = 0;
  let passedCount = 0;
  let assertionCount = 0;
  let firstFailureOrdinal = null;
  const counters = { productionRecords: 0 };
  try {
    try {
      miniRuntime = await loadMiniRuntime(mini, setupCheck, network);
      const startSandbox = await loadStartSandbox(agentCore.directory);
      platform = await startGuardedPlatform(startSandbox, network);
      await validatePlatformRuntime(platform, setupCheck);
      const state = {
        mini: miniRuntime,
        platform,
        bffEnv: {
          AGENT_CORE_BASE_URL: platform.sandbox.baseUrl,
          AGENT_CORE_TENANT_KEY: platform.sandbox.token,
          AGENT_CORE_PAGE_SIZE: "20",
          STOREFRONT_ORIGIN,
          ALLOWED_ORIGINS: STOREFRONT_ORIGIN,
        },
      };
      assertionCount += setupCheck.count;
      for (let index = 0; index < dataset.journeys.length; index += 1) {
        attemptedCount += 1;
        const journeyCheck = verifier();
        try {
          await runJourney(state, dataset.journeys[index], counters, journeyCheck);
          passedCount += 1;
        } catch {
          if (firstFailureOrdinal === null) firstFailureOrdinal = index + 1;
        } finally {
          assertionCount += journeyCheck.count;
        }
      }
    } catch {
      // Provenance was already verified, so a sanitized aggregate with zero
      // attempted journeys is stronger evidence than silently losing the
      // first initialization failure. The CLI still exits non-zero.
      assertionCount += setupCheck.count;
    }
  } finally {
    await platform?.close().catch(() => {});
    await miniRuntime?.close().catch(() => {});
    network.restore();
  }

  // Re-check after every runtime has stopped so a concurrent checkout edit
  // cannot pass on provenance sampled only before execution.
  await Promise.all([
    repositoryDescriptor(mini.directory, mini.commit, "Mini Suntek"),
    repositoryDescriptor(agentCore.directory, agentCore.commit, "Agent Core"),
    repositoryDescriptor(referenceStore.directory, referenceStore.commit, "Reference Store"),
  ]);

  const artifact = createArtifact({
    repositories,
    journeyCount: dataset.journeys.length,
    attemptedCount,
    passedCount,
    assertionCount,
    firstFailureOrdinal,
    network: network.counts,
    productionRecords: counters.productionRecords,
  });
  const output = await writeArtifactNew(parsed.output, artifact, [root, mini.directory, agentCore.directory]);
  return { artifact, output };
}

async function runCli() {
  try {
    const { artifact, output } = await runTriad({ args: process.argv.slice(2) });
    const message = `${artifact.aggregate.status.toUpperCase()}: synthetic contract projection ${artifact.aggregate.passed_count}/${artifact.aggregate.journey_count}`;
    const stream = artifact.aggregate.status === "contract_passed" ? process.stdout : process.stderr;
    stream.write(`${message}\n`);
    stream.write(`Mini Suntek SHA: ${artifact.repositories.mini_suntek}\n`);
    stream.write(`Agent Core SHA: ${artifact.repositories.agent_core}\n`);
    stream.write(`Reference Store SHA: ${artifact.repositories.reference_store}\n`);
    stream.write(`Sanitized aggregate artifact: ${output}\n`);
    if (artifact.aggregate.status !== "contract_passed") process.exitCode = 1;
  } catch {
    process.stderr.write("FAIL: contract projection initialization was rejected; no request, response, product, credential, or repository path was emitted.\n");
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli();
}
