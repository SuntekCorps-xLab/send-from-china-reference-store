import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createCiEvidence,
  validateBrowserInputs,
  validateCiEvidence,
} from "../generate-ci-evidence.mjs";

const repository = {
  name: "send-from-china-reference-store",
  version: "1.1.0",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
};

function browserInputs() {
  const cases = [];
  for (const browser of ["chromium", "firefox", "webkit"]) {
    for (const viewport of ["1440x1000", "390x844"]) {
      cases.push({
        browser, viewport, overflow: 0, console_errors: 0, external_requests: 0,
        axe_serious_critical: 0, reduced_motion: true, receipt_exact: true,
      });
    }
  }
  return {
    shopify: { ok: true, cases },
    liquid: {
      ok: true, live_shopify_verified: false,
      requested_browsers: ["chromium", "firefox", "webkit"],
      browser_startups: ["chromium", "firefox", "webkit"].map((browser) => ({ browser, ok: true })),
      cases: ["chromium", "firefox", "webkit"].flatMap((browser) => ["1440x1000", "390x844"].map((viewport, index) => ({
        browser,
        viewport,
        successful_runs: 2,
        journeys: Array.from({ length: 6 }, () => ({
          overflow: 0, console_errors: 0, page_errors: 0, axe_serious_critical: 0,
          reduced_motion: true, storage_empty: true, credentials_isolated: true,
          external_requests: 0, legacy_requests: 0,
        })),
        ...(browser === "chromium" && index === 0 ? {
          additional_journeys: Array.from({ length: 6 }, () => ({
            overflow: 0, console_errors: 0, page_errors: 0, axe_serious_critical: 0,
            reduced_motion: true, storage_empty: true, credentials_isolated: true,
            external_requests: 0, legacy_requests: 0,
          })),
        } : {}),
      }))),
    },
  };
}

test("browser and safety evidence is closed, exact-SHA-bound, and sanitized", () => {
  for (const kind of ["browser", "safety"]) {
    const artifact = createCiEvidence(kind, repository);
    assert.equal(validateCiEvidence(artifact, repository), artifact);
    assert.equal(artifact.repository.commit, repository.commit);
    assert.equal(artifact.repository.tree, repository.tree);
    assert.doesNotMatch(JSON.stringify(artifact), /query|response|token|credential_value|host|url|path/u);
  }
});

test("CI evidence rejects wrong identity, private fields, and duplicate checks", () => {
  const artifact = createCiEvidence("browser", repository);
  assert.throws(() => validateCiEvidence(artifact, { ...repository, commit: "c".repeat(40) }), /invalid/u);
  assert.throws(() => validateCiEvidence({ ...artifact, private_field: true }, repository), /invalid/u);
  assert.throws(() => validateCiEvidence({ ...artifact, checks: [artifact.checks[0], artifact.checks[0]] }, repository), /invalid/u);
});

test("browser inputs require the complete zero-error three-browser matrix", () => {
  const { shopify, liquid } = browserInputs();
  assert.doesNotThrow(() => validateBrowserInputs(shopify, liquid));
  assert.throws(() => validateBrowserInputs({ ...shopify, cases: shopify.cases.slice(1) }, liquid), /invalid/u);
  assert.throws(() => validateBrowserInputs({
    ...shopify,
    cases: shopify.cases.map((item, index) => index === 0 ? { ...item, external_requests: 1 } : item),
  }, liquid), /failed/u);
  assert.throws(() => validateBrowserInputs(shopify, { ...liquid, live_shopify_verified: true }), /invalid/u);
  assert.throws(() => validateBrowserInputs(shopify, {
    ...liquid,
    cases: liquid.cases.map((item, index) => index === 0
      ? { ...item, journeys: item.journeys.map((journey, journeyIndex) => journeyIndex === 0 ? { ...journey, credentials_isolated: false } : journey) }
      : item),
  }), /failed/u);
});

test("the CI evidence schema recursively closes every object", async () => {
  const schema = JSON.parse(await readFile(new URL("../../contracts/ci-evidence.v1.schema.json", import.meta.url), "utf8"));
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") assert.equal(node.additionalProperties, false);
    for (const value of Object.values(node)) visit(value);
  };
  visit(schema);
});

test("CI uploads separate exact-SHA browser and safety evidence artifacts", async () => {
  const workflow = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(workflow, /--kind browser[\s\S]*--shopify-result[\s\S]*--liquid-report/u);
  assert.match(workflow, /name: reference-store-browser-evidence/u);
  assert.match(workflow, /--kind safety/u);
  assert.match(workflow, /name: reference-store-safety-evidence/u);
  assert.match(workflow, /if-no-files-found: error/gu);
});

test("exact-SHA evidence confines Git's safe-directory exception to this checkout", async () => {
  const source = await readFile(new URL("../generate-ci-evidence.mjs", import.meta.url), "utf8");
  assert.match(source, /"-c", `safe\.directory=\$\{root\}`/u);
  assert.doesNotMatch(source, /git config --global|safe\.directory=\*/u);
});
