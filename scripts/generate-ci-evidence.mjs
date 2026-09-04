import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "send-from-china-reference-store-ci-evidence/v1";
const CHECKS = Object.freeze({
  browser: ["shopify_sandbox_three_browser", "liquid_app_proxy_three_browser"],
  safety: ["documentation_links", "public_safety_scan", "cyclonedx_sbom"],
});

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function git(...args) {
  return execFileSync("git", ["--no-optional-locks", ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    windowsHide: true,
  }).trim();
}

export function observedRepository() {
  if (git("status", "--porcelain=v1", "--untracked-files=no")) {
    throw new Error("ci_evidence_tracked_worktree_dirty");
  }
  const commit = git("rev-parse", "HEAD");
  const tree = git("rev-parse", "HEAD^{tree}");
  if (!/^[0-9a-f]{40}$/u.test(commit) || !/^[0-9a-f]{40}$/u.test(tree)) {
    throw new Error("ci_evidence_repository_identity_invalid");
  }
  return { name: "send-from-china-reference-store", version: "1.1.0", commit, tree };
}

function expectedCases() {
  return new Set([
    "chromium/1440x1000", "chromium/390x844",
    "firefox/1440x1000", "firefox/390x844",
    "webkit/1440x1000", "webkit/390x844",
  ]);
}

export function validateBrowserInputs(shopify, liquid) {
  if (shopify?.ok !== true || !Array.isArray(shopify.cases) || shopify.cases.length !== 6) {
    throw new Error("ci_browser_shopify_result_invalid");
  }
  const observed = new Set();
  for (const item of shopify.cases) {
    const key = `${item?.browser}/${item?.viewport}`;
    observed.add(key);
    if (item?.overflow > 1 || item?.console_errors !== 0 || item?.external_requests !== 0
      || item?.axe_serious_critical !== 0 || item?.reduced_motion !== true
      || item?.receipt_exact !== true) {
      throw new Error("ci_browser_shopify_gate_failed");
    }
  }
  const expected = expectedCases();
  if (observed.size !== expected.size || [...expected].some((item) => !observed.has(item))) {
    throw new Error("ci_browser_shopify_matrix_invalid");
  }
  if (liquid?.ok !== true || liquid?.live_shopify_verified !== false
    || !Array.isArray(liquid.requested_browsers)
    || liquid.requested_browsers.join(",") !== "chrome,firefox,webkit"
    || !Array.isArray(liquid.browser_startups) || liquid.browser_startups.length !== 3
    || liquid.browser_startups.some((item) => item?.ok !== true)
    || !Array.isArray(liquid.cases) || liquid.cases.length !== 6) {
    throw new Error("ci_browser_liquid_result_invalid");
  }
  const expectedLiquid = new Set([
    "chrome/1440x1000", "chrome/390x844",
    "firefox/1440x1000", "firefox/390x844",
    "webkit/1440x1000", "webkit/390x844",
  ]);
  const observedLiquid = new Set();
  let journeyCount = 0;
  for (const item of liquid.cases) {
    observedLiquid.add(`${item?.browser}/${item?.viewport}`);
    if (item?.successful_runs !== 2 || !Array.isArray(item?.journeys) || item.journeys.length !== 6) {
      throw new Error("ci_browser_liquid_result_invalid");
    }
    const journeys = [...item.journeys, ...(item.additional_journeys || [])];
    journeyCount += journeys.length;
    if (journeys.some((journey) => journey?.overflow > 1
      || journey?.console_errors !== 0 || journey?.page_errors !== 0
      || journey?.axe_serious_critical !== 0 || journey?.reduced_motion !== true
      || journey?.storage_empty !== true || journey?.credentials_isolated !== true
      || journey?.external_requests !== 0 || journey?.legacy_requests !== 0)) {
      throw new Error("ci_browser_liquid_gate_failed");
    }
  }
  if (observedLiquid.size !== expectedLiquid.size
    || [...expectedLiquid].some((item) => !observedLiquid.has(item))
    || journeyCount !== 42) {
    throw new Error("ci_browser_liquid_matrix_invalid");
  }
}

export function createCiEvidence(kind, repository) {
  if (!Object.hasOwn(CHECKS, kind)
    || !exactKeys(repository, ["name", "version", "commit", "tree"])
    || repository.name !== "send-from-china-reference-store"
    || repository.version !== "1.1.0"
    || !/^[0-9a-f]{40}$/u.test(repository.commit)
    || !/^[0-9a-f]{40}$/u.test(repository.tree)) {
    throw new Error("ci_evidence_input_invalid");
  }
  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    evidence_kind: kind,
    repository,
    checks: [...CHECKS[kind]],
    gates: {
      status: "PASS",
      credential_exposure: 0,
      sensitive_field_count: 0,
      external_network_request_count: 0,
      app_proxy_live_verified: false,
    },
  };
}

export function validateCiEvidence(value, expectedRepository) {
  const valid = exactKeys(value, ["schema_version", "generated_at", "evidence_kind", "repository", "checks", "gates"])
    && value.schema_version === SCHEMA_VERSION
    && typeof value.generated_at === "string" && Number.isFinite(Date.parse(value.generated_at))
    && Object.hasOwn(CHECKS, value.evidence_kind)
    && exactKeys(value.repository, ["name", "version", "commit", "tree"])
    && Object.entries(expectedRepository).every(([key, expected]) => value.repository[key] === expected)
    && Array.isArray(value.checks)
    && value.checks.length === CHECKS[value.evidence_kind].length
    && new Set(value.checks).size === value.checks.length
    && CHECKS[value.evidence_kind].every((check) => value.checks.includes(check))
    && exactKeys(value.gates, ["status", "credential_exposure", "sensitive_field_count", "external_network_request_count", "app_proxy_live_verified"])
    && value.gates.status === "PASS"
    && value.gates.credential_exposure === 0
    && value.gates.sensitive_field_count === 0
    && value.gates.external_network_request_count === 0
    && value.gates.app_proxy_live_verified === false;
  if (!valid) throw new Error("ci_evidence_invalid");
  return value;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) {
      throw new Error("ci_evidence_arguments_invalid");
    }
    args[argv[index].slice(2)] = argv[index + 1];
  }
  if (!Object.hasOwn(CHECKS, args.kind) || !args.output) throw new Error("ci_evidence_arguments_invalid");
  const expected = args.kind === "browser"
    ? ["kind", "liquid-report", "output", "shopify-result"]
    : ["kind", "output"];
  if (Object.keys(args).sort().join(",") !== expected.sort().join(",")) {
    throw new Error("ci_evidence_arguments_invalid");
  }
  return args;
}

function confinedOutput(value) {
  const output = path.resolve(root, value);
  const relative = path.relative(path.resolve(root, "artifacts", "ci-evidence"), output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("ci_evidence_output_not_confined");
  }
  return output;
}

async function validateInputs(args) {
  if (args.kind === "browser") {
    if (!args["shopify-result"] || !args["liquid-report"]) throw new Error("ci_browser_inputs_missing");
    const shopifyPath = path.resolve(root, args["shopify-result"]);
    const liquidPath = path.resolve(root, args["liquid-report"]);
    if (shopifyPath !== path.resolve(root, "build", "ci-evidence-input", "shopify-browser.json")
      || liquidPath !== path.resolve(root, "work", "shopify-liquid-qa", "report.json")) {
      throw new Error("ci_browser_input_path_invalid");
    }
    const [shopify, liquid] = await Promise.all([
      readFile(shopifyPath, "utf8").then(JSON.parse),
      readFile(liquidPath, "utf8").then(JSON.parse),
    ]);
    validateBrowserInputs(shopify, liquid);
    return;
  }
  for (const name of ["reference-store.cdx.json", "storefront-bff.cdx.json", "customer-account.cdx.json"]) {
    const sbom = JSON.parse(await readFile(path.resolve(root, "artifacts", "sbom", name), "utf8"));
    if (sbom.bomFormat !== "CycloneDX" || !sbom.specVersion) throw new Error("ci_safety_sbom_invalid");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await validateInputs(args);
  const repository = observedRepository();
  const artifact = createCiEvidence(args.kind, repository);
  validateCiEvidence(artifact, repository);
  const output = confinedOutput(args.output);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`PASS: wrote ${args.kind} evidence for ${repository.commit}.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("FAIL: CI evidence generation failed; no path, payload, or credential details were emitted.\n");
    process.exitCode = 1;
  });
}
