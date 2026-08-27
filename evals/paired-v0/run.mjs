import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import storefrontBff from "../../storefront-bff/src/index.js";
import {
  loadStartSandbox,
  resolveAgentCoreDirectory,
  startPlatform,
} from "../../scripts/demo-platform.mjs";
import { loadDataset } from "./dataset.mjs";

const RUNNER_VERSION = "paired-e2e-runner/v0.1.0";
const ARTIFACT_SCHEMA_VERSION = "send-from-china-paired-e2e-artifact/v0";
const LOOPBACK_HOSTS = new Set(["localhost", "[::1]", "127.0.0.1"]);
const STOREFRONT_ORIGIN = "https://sandbox-store.example.invalid";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argumentValue(args, name) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
    if (argument === name) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new TypeError(`${name} requires a value`);
      return value;
    }
  }
  return "";
}

function git(directory, args) {
  const result = spawnSync("git", ["-c", `safe.directory=${directory}`, "-C", directory, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("unable to read paired repository provenance");
  return String(result.stdout || "").trim();
}

export function repositoryDescriptor(directory) {
  const commit = git(directory, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error("paired repository commit is invalid");
  const dirty = Boolean(git(directory, ["status", "--porcelain", "--untracked-files=normal"]));
  return { commit, working_tree: dirty ? "dirty" : "clean" };
}

function fetchUrl(input) {
  if (input instanceof Request) return new URL(input.url);
  if (input instanceof URL) return input;
  return new URL(String(input));
}

function isLoopback(url) {
  return (url.protocol === "http:" || url.protocol === "https:")
    && LOOPBACK_HOSTS.has(url.hostname)
    && !url.username
    && !url.password;
}

function installNetworkGuard() {
  const nativeFetch = globalThis.fetch;
  const counts = { local: 0, external: 0 };
  globalThis.fetch = async (input, init) => {
    const url = fetchUrl(input);
    if (!isLoopback(url)) {
      counts.external += 1;
      throw new Error("paired E2E blocked a non-loopback network request");
    }
    counts.local += 1;
    return nativeFetch(input, init);
  };
  return {
    counts,
    restore() {
      globalThis.fetch = nativeFetch;
    },
  };
}

function verifier() {
  let assertionCount = 0;
  return {
    get count() { return assertionCount; },
    ok(value, message) {
      assertionCount += 1;
      assert.ok(value, message);
    },
    equal(actual, expected, message) {
      assertionCount += 1;
      assert.equal(actual, expected, message);
    },
    deepEqual(actual, expected, message) {
      assertionCount += 1;
      assert.deepEqual(actual, expected, message);
    },
    match(actual, expected, message) {
      assertionCount += 1;
      assert.match(actual, expected, message);
    },
  };
}

function authHeaders(token, json = false) {
  const headers = new Headers({ accept: "application/json" });
  headers.set("authorization", ["Bearer", token].join(" "));
  if (json) headers.set("content-type", "application/json");
  return headers;
}

function searchContract(identity, { limit = 3, cursor = null } = {}) {
  return {
    contract_version: "2.0",
    product_identity: {
      name: "product_identity",
      value: identity,
      source: "explicit",
      scope: "product",
      hardness: "hard",
    },
    hard_constraints: [],
    soft_context: [],
    transaction_context: [],
    limit,
    cursor,
  };
}

async function readJson(response) {
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

async function coreCall(state, route, init = {}) {
  return readJson(await fetch(`${state.runtime.sandbox.baseUrl}${route}`, init));
}

async function canonicalSearch(state, identity, options = {}) {
  return coreCall(state, "/api/search/v2", {
    method: "POST",
    headers: authHeaders(state.runtime.sandbox.token, true),
    body: JSON.stringify(searchContract(identity, options)),
  });
}

async function bffCall(state, route, body, origin = STOREFRONT_ORIGIN) {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  const response = await storefrontBff.fetch(new Request(`https://bff.example.invalid${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }), state.bffEnv);
  return readJson(response);
}

async function demoCall(state, route, body) {
  const init = body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
  return readJson(await fetch(`${state.runtime.demo.baseUrl}${route}`, init));
}

async function bffSyntheticState(state, targetStatus) {
  const base = await canonicalSearch(state, "desk organizer", { limit: 3 });
  if (base.response.status !== 200 || base.body.status !== "results") {
    throw new Error("synthetic BFF state requires the paired fixture result contract");
  }
  const payload = structuredClone(base.body);
  payload.status = targetStatus;
  payload.results = [];
  payload.missing_criteria = targetStatus === "needs_clarification" ? ["material"] : [];
  payload.pagination = {
    limit: 3,
    cursor: null,
    next_cursor: null,
    has_more: false,
  };
  payload.search_scope = {
    plan_complete: false,
    scope_exhausted: false,
    global_catalog_exhaustive: false,
    scan_limit_reached: false,
    degraded: targetStatus === "degraded",
    degraded_reason: targetStatus === "degraded" ? "synthetic_eval_unavailable" : null,
  };

  const guardedFetch = globalThis.fetch;
  const coreOrigin = new URL(state.runtime.sandbox.baseUrl).origin;
  globalThis.fetch = async (input, init) => {
    const url = fetchUrl(input);
    if (url.origin === coreOrigin && url.pathname === "/api/search/v2") {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return guardedFetch(input, init);
  };
  try {
    return await bffCall(state, "/api/search", {
      search_contract: searchContract("desk organizer", { limit: 3 }),
    });
  } finally {
    globalThis.fetch = guardedFetch;
  }
}

const handlers = {
  async capability_discovery(state, check) {
    const result = await coreCall(state, "/.well-known/send-from-china.json", {
      headers: { accept: "application/json" },
    });
    check.equal(result.response.status, 200, "capability discovery must be public");
    check.equal(result.body.service, "send-from-china-agent-core", "service identity must be explicit");
    check.equal(result.body.capabilities?.search_contract_v2, true, "Search Contract v2 must be advertised");
    for (const capability of ["shipping_rates", "cart", "checkout", "order", "payment"]) {
      check.equal(result.body.capabilities?.[capability], false, `${capability} must remain unsupported`);
    }
    return "capabilities_declared";
  },

  async sandbox_status(state, check) {
    const result = await coreCall(state, "/sandbox/status");
    check.equal(result.response.status, 200, "sandbox status must be available");
    check.equal(result.body.mode, "synthetic_local_sandbox", "sandbox mode must be explicit");
    check.equal(result.body.data_source, "synthetic_fixture", "sandbox provenance must be explicit");
    check.equal(result.body.purchasable, false, "sandbox must not be purchasable");
    check.equal(result.body.shipping_rates, false, "sandbox must not expose carrier rates");
    check.equal(result.body.commerce_writes, false, "sandbox must not expose commerce writes");
    check.equal(result.body.credential_exposed, false, "sandbox credential must remain server-side");
    return "synthetic_read_only";
  },

  async http_v2_results(state, check) {
    const result = await canonicalSearch(state, "desk organizer", { limit: 3 });
    check.equal(result.response.status, 200, "authenticated v2 search must succeed");
    check.equal(result.body.contract_version, "2.0", "response must retain contract version");
    check.equal(result.body.status, "results", "fixture query must return results");
    check.ok(result.body.results.length >= 1, "fixture result list must not be empty");
    check.equal(result.body.normalized_intent?.product_identity?.value, "desk organizer", "identity must round-trip");
    return result.body.status;
  },

  async http_v2_no_match(state, check) {
    const result = await canonicalSearch(state, "quartz violin umbrella", { limit: 5 });
    check.equal(result.response.status, 200, "terminal v2 search must return a contract response");
    check.equal(result.body.status, "no_match", "absent fixture product must be a terminal miss");
    check.deepEqual(result.body.results, [], "terminal miss must not include results");
    check.equal(result.body.search_scope?.plan_complete, true, "terminal miss plan must be complete");
    check.equal(result.body.search_scope?.scope_exhausted, true, "terminal miss scope must be exhausted");
    check.equal(result.body.search_scope?.degraded, false, "terminal miss must not hide degradation");
    return result.body.status;
  },

  async http_v2_needs_clarification(state, check) {
    const result = await bffSyntheticState(state, "needs_clarification");
    check.equal(result.response.status, 200, "valid clarification state must pass the BFF adapter");
    check.equal(result.body.status, "needs_clarification", "clarification must not become a miss");
    check.deepEqual(result.body.missing_criteria, ["material"], "missing criteria must survive projection");
    check.deepEqual(result.body.results, [], "clarification must not invent a result");
    check.equal(result.body.search_scope?.degraded, false, "clarification must remain distinct from degradation");
    return result.body.status;
  },

  async http_v2_degraded(state, check) {
    const result = await bffSyntheticState(state, "degraded");
    check.equal(result.response.status, 200, "valid degraded state must pass the BFF adapter");
    check.equal(result.body.status, "degraded", "degraded must not become a miss");
    check.deepEqual(result.body.results, [], "degraded state must not invent a result");
    check.equal(result.body.search_scope?.degraded, true, "degraded scope flag must survive projection");
    check.equal(result.body.search_scope?.degraded_reason, "synthetic_eval_unavailable", "safe reason must survive projection");
    return result.body.status;
  },

  async mcp_discovery(state, check) {
    const result = await coreCall(state, "/sandbox/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "paired-tools", method: "tools/list" }),
    });
    check.equal(result.response.status, 200, "sandbox MCP discovery must succeed without caller credentials");
    check.equal(result.body.result?.tools?.length, 8, "sandbox MCP must expose the bounded tool catalog");
    check.equal(result.response.headers.get("x-send-from-china-sandbox-mode"), "synthetic_local_sandbox", "MCP response must carry the sandbox boundary");
    check.equal(result.text.includes(state.runtime.sandbox.token), false, "MCP discovery must not expose the injected credential");
    return "tools_listed";
  },

  async mcp_search(state, check) {
    const result = await coreCall(state, "/sandbox/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "paired-search",
        method: "tools/call",
        params: {
          name: "product_search",
          arguments: {
            query: "desk organizer",
            criteria: { price_max: 40 },
            operation: "search",
            limit: 3,
          },
        },
      }),
    });
    const content = result.body.result?.structuredContent;
    check.equal(result.response.status, 200, "sandbox MCP search must succeed");
    check.ok(content?.products?.length >= 1, "sandbox MCP search must return a fixture result");
    check.equal(content.products[0].availability_band, "demo_only", "MCP fixture availability must remain illustrative");
    check.equal(content.products[0].purchasable, false, "MCP fixture result must be non-purchasable");
    check.equal(content.products[0].available, false, "MCP fixture availability must not be asserted");
    check.equal(result.text.includes(state.runtime.sandbox.token), false, "MCP result must not expose the injected credential");
    return "results";
  },

  async bff_chat_results(state, check) {
    const result = await bffCall(state, "/api/chat", {
      session_id: "paired_v0_chat_result",
      messages: [{ role: "user", content: "desk organizer" }],
      criteria: {},
    });
    check.equal(result.response.status, 200, "BFF chat must reach the paired Agent Core");
    check.ok(result.body.results?.length >= 1, "fixture chat must return a result");
    check.equal(result.body.live_agent_core, true, "BFF must identify the connected source");
    check.equal(result.body.results[0].available, false, "BFF must not infer Shopify availability");
    check.equal(result.text.includes(state.runtime.sandbox.token), false, "BFF chat must not expose the tenant credential");
    return "results";
  },

  async bff_chat_no_match(state, check) {
    const result = await bffCall(state, "/api/chat", {
      session_id: "paired_v0_chat_miss",
      messages: [{ role: "user", content: "desk organizer" }],
      criteria: { category: "Office", price_max: 15, ship_to: "US" },
    });
    check.equal(result.response.status, 200, "filtered BFF chat must return a bounded response");
    check.deepEqual(result.body.results, [], "hard-filtered fixture miss must stay empty");
    check.equal(result.body.dynamic_request_recommended, true, "terminal chat miss may recommend the explicit preview workflow");
    check.ok(result.body.criteria_evaluation?.enforced?.includes("price_max"), "hard price filter must be reported as enforced");
    return "no_match";
  },

  async bff_search_results(state, check) {
    const result = await bffCall(state, "/api/search", {
      search_contract: searchContract("desk organizer", { limit: 1 }),
    });
    check.equal(result.response.status, 200, "BFF v2 search must succeed");
    check.equal(result.body.status, "results", "BFF v2 search must preserve results status");
    check.equal(result.body.pagination?.limit, 1, "BFF must preserve the effective page limit");
    check.equal(result.body.results?.length, 1, "fixture request must return the bounded page");
    check.equal(result.text.includes(state.runtime.sandbox.token), false, "BFF search must not expose the tenant credential");
    return result.body.status;
  },

  async bff_search_no_match(state, check) {
    const result = await bffCall(state, "/api/search", { q: "quartz violin umbrella", limit: 5 });
    check.equal(result.response.status, 200, "BFF terminal search must return a contract response");
    check.equal(result.body.status, "no_match", "BFF must preserve terminal no-match status");
    check.deepEqual(result.body.results, [], "BFF terminal miss must remain empty");
    check.equal(result.body.search_scope?.plan_complete, true, "BFF terminal miss plan must be complete");
    check.equal(result.body.search_scope?.scope_exhausted, true, "BFF terminal miss scope must be exhausted");
    check.equal(result.body.search_scope?.degraded, false, "BFF terminal miss must remain non-degraded");
    return result.body.status;
  },

  async origin_rejection(state, check) {
    const before = state.network.counts.local;
    const result = await bffCall(state, "/api/search", { q: "desk organizer", limit: 1 }, "https://unapproved.example.invalid");
    check.equal(result.response.status, 403, "unapproved browser origin must be rejected");
    check.equal(result.body.error, "origin_not_allowed", "origin rejection must be explicit");
    check.equal(state.network.counts.local, before, "origin rejection must happen before an upstream call");
    return "origin_rejected";
  },

  async authentication_rejection(state, check) {
    const request = searchContract("desk organizer", { limit: 1 });
    const missing = await coreCall(state, "/api/search/v2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const invalid = await coreCall(state, "/api/search/v2", {
      method: "POST",
      headers: authHeaders("invalid-paired-e2e-credential", true),
      body: JSON.stringify(request),
    });
    check.equal(missing.response.status, 401, "missing credential must be rejected");
    check.equal(missing.body.error?.code, "MISSING_CREDENTIAL", "missing credential code must be stable");
    check.equal(invalid.response.status, 401, "invalid credential must be rejected");
    check.equal(invalid.body.error?.code, "INVALID_CREDENTIAL", "invalid credential code must be stable");
    return "authentication_rejected";
  },

  async credential_isolation(state, check) {
    const pageResponse = await fetch(`${state.runtime.demo.baseUrl}/`);
    const page = await pageResponse.text();
    const status = await demoCall(state, "/api/status");
    const chat = await demoCall(state, "/api/chat", {
      session_id: "paired_v0_isolation",
      messages: [{ role: "user", content: "desk organizer" }],
      criteria: {},
    });
    const browserSurfaces = [page, status.text, chat.text].join("\n");
    check.equal(pageResponse.status, 200, "connected demo page must load");
    check.equal(status.response.status, 200, "connected demo status must load");
    check.equal(chat.response.status, 200, "connected demo chat must load");
    check.equal(browserSurfaces.includes(state.runtime.sandbox.token), false, "browser surfaces must not contain the tenant credential");
    check.equal(status.body.live_agent_core, true, "status must identify the verified local connection without revealing its key");
    return "credential_isolated";
  },

  async purchase_link_separation(state, check) {
    const bff = await bffCall(state, "/api/search", {
      search_contract: searchContract("desk organizer", { limit: 1 }),
    });
    const product = bff.body.results?.[0];
    check.equal(bff.response.status, 200, "BFF fixture search must succeed");
    check.ok(product?.browse_url?.startsWith(`${STOREFRONT_ORIGIN}/products/`), "derived browse URL must remain available for navigation");
    check.equal(product?.product_url, "", "derived browse URL must not become verified product evidence");
    check.equal(product?.add_to_cart_url, "", "unverified fixture must not expose add-to-cart evidence");
    check.equal(product?.available, false, "unverified fixture must not claim availability");
    check.equal(product?.purchase_handoff, null, "unverified fixture must not claim a purchase handoff");

    const demo = await demoCall(state, "/api/search", { q: "desk organizer", limit: 1 });
    const locked = demo.body.results?.[0];
    check.equal(demo.response.status, 200, "connected demo fixture search must succeed");
    check.equal(locked?.browse_url, "", "connected demo must re-lock all purchase-adjacent URLs");
    check.equal(locked?.purchasable, false, "connected demo fixture must remain non-purchasable");
    return "purchase_link_separated";
  },

  async cursor_pagination(state, check) {
    const first = await canonicalSearch(state, "a", { limit: 1 });
    const cursor = first.body.pagination?.next_cursor;
    check.equal(first.response.status, 200, "first cursor page must succeed");
    check.equal(first.body.status, "results", "first cursor page must contain a result");
    check.match(String(cursor || ""), /^sc2_[0-9a-f]{16}_/u, "first cursor page must issue a bound cursor");
    const second = await canonicalSearch(state, "a", { limit: 1, cursor });
    check.equal(second.response.status, 200, "second cursor page must succeed");
    check.equal(second.body.status, "results", "second cursor page must contain a result");
    const firstIds = new Set(first.body.results.map((product) => product.public_id));
    check.ok(second.body.results.every((product) => !firstIds.has(product.public_id)), "cursor pages must not overlap");
    return "cursor_advanced";
  },

  async cursor_refine_rejection(state, check) {
    const first = await canonicalSearch(state, "a", { limit: 1 });
    const cursor = first.body.pagination?.next_cursor;
    check.match(String(cursor || ""), /^sc2_[0-9a-f]{16}_/u, "fixture must issue a bound cursor");
    const refined = await canonicalSearch(state, "desk organizer", { limit: 1, cursor });
    check.equal(refined.response.status, 400, "cursor reuse after refinement must be rejected");
    check.equal(refined.body.error?.code, "INVALID_SEARCH_CONTRACT", "cursor intent mismatch must use the stable contract error");
    return "cursor_rejected";
  },

  async agent_core_no_write(state, check) {
    for (const route of ["/api/cart", "/api/checkout", "/api/order", "/api/payment"]) {
      const result = await coreCall(state, route, {
        method: "POST",
        headers: authHeaders(state.runtime.sandbox.token, true),
        body: "{}",
      });
      check.equal(result.response.status, 404, `${route} must not be implemented by Agent Core`);
      check.equal(result.body.error?.code, "NOT_FOUND", `${route} must fail closed`);
    }
    const health = await coreCall(state, "/health");
    check.equal(health.body.writes_enabled, false, "Agent Core health must remain read-only");
    return "writes_unavailable";
  },

  async storefront_no_write(state, check) {
    for (const route of ["/api/cart", "/api/checkout", "/api/order", "/api/payment"]) {
      const result = await demoCall(state, route, {});
      check.equal(result.response.status, 404, `${route} must not be implemented by the Reference demo`);
      check.equal(result.body.error, "not_found", `${route} must fail closed`);
    }
    const status = await demoCall(state, "/api/status");
    check.equal(status.body.commerce_writes, false, "Reference demo status must remain read-only");
    return "writes_unavailable";
  },
};

export function createArtifact({ dataset, datasetHash, repositories, outcomes, externalNetworkRequests }) {
  const passedCount = outcomes.filter((outcome) => outcome.status === "passed").length;
  const failedCount = outcomes.length - passedCount;
  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    runner_version: RUNNER_VERSION,
    generated_at: new Date().toISOString(),
    provenance: "public_synthetic",
    repositories,
    dataset: {
      version: dataset.dataset_version,
      sha256: datasetHash,
      journey_count: dataset.journeys.length,
    },
    boundaries: {
      external_network_request_count: externalNetworkRequests,
      successful_commerce_write_count: 0,
      production_record_count: 0,
    },
    summary: {
      status: failedCount === 0 && externalNetworkRequests === 0 ? "passed" : "failed",
      passed_count: passedCount,
      failed_count: failedCount,
      total_count: outcomes.length,
    },
    journeys: outcomes.map(({ case_id, status, assertion_count }) => ({
      case_id,
      status,
      assertion_count,
    })),
  };
}

export async function runPairedE2e(options = {}) {
  const args = options.args || [];
  const output = path.resolve(root, options.output || argumentValue(args, "--output") || "build/paired-e2e-v0/artifact.json");
  const { bytes, dataset } = await loadDataset();
  const datasetHash = createHash("sha256").update(bytes).digest("hex");
  const agentCoreDirectory = options.agentCoreDirectory
    || await resolveAgentCoreDirectory({ args, cwd: root });
  const repositories = {
    reference_store: repositoryDescriptor(root),
    agent_core: repositoryDescriptor(agentCoreDirectory),
  };
  const network = installNetworkGuard();
  let runtime;
  const outcomes = [];
  try {
    const startSandbox = await loadStartSandbox(agentCoreDirectory);
    runtime = await startPlatform({
      startSandbox,
      sandboxPort: 0,
      demoPort: 0,
      host: "127.0.0.1",
    });
    const state = {
      runtime,
      network,
      bffEnv: {
        AGENT_CORE_BASE_URL: runtime.sandbox.baseUrl,
        AGENT_CORE_TENANT_KEY: runtime.sandbox.token,
        AGENT_CORE_PAGE_SIZE: "20",
        STOREFRONT_ORIGIN,
        ALLOWED_ORIGINS: STOREFRONT_ORIGIN,
      },
    };

    for (const journey of dataset.journeys) {
      const check = verifier();
      let status = "passed";
      try {
        const handler = handlers[journey.action];
        if (typeof handler !== "function") throw new Error("paired journey action has no runner");
        const observed = await handler(state, check);
        check.equal(observed, journey.expected_status, "journey expected status must match");
      } catch {
        status = "failed";
      }
      outcomes.push({ case_id: journey.case_id, status, assertion_count: check.count });
    }
  } finally {
    await runtime?.close().catch(() => {});
    network.restore();
  }

  const artifact = createArtifact({
    dataset,
    datasetHash,
    repositories,
    outcomes,
    externalNetworkRequests: network.counts.external,
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return { artifact, output };
}

async function runCli() {
  const { artifact, output } = await runPairedE2e({ args: process.argv.slice(2) });
  const failed = artifact.journeys.filter((journey) => journey.status === "failed");
  if (artifact.summary.status !== "passed") {
    process.stderr.write(`FAIL: paired E2E ${artifact.summary.passed_count}/${artifact.summary.total_count}; failed cases: ${failed.map((item) => item.case_id).join(", ")}\n`);
    process.stderr.write(`Sanitized artifact: ${path.relative(root, output)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`PASS: paired E2E ${artifact.summary.passed_count}/${artifact.summary.total_count}\n`);
  process.stdout.write(`Dataset SHA-256: ${artifact.dataset.sha256}\n`);
  process.stdout.write(`Reference Store SHA: ${artifact.repositories.reference_store.commit}\n`);
  process.stdout.write(`Agent Core SHA: ${artifact.repositories.agent_core.commit}\n`);
  process.stdout.write(`Sanitized artifact: ${path.relative(root, output)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch(() => {
    process.stderr.write("FAIL: paired E2E could not initialize; no request or credential details were emitted.\n");
    process.exitCode = 1;
  });
}
