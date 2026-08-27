import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { ACTIONS, loadDataset } from "../dataset.mjs";
import { createArtifact } from "../run.mjs";

test("the public synthetic dataset contains exactly one journey per release action", async () => {
  const { dataset } = await loadDataset();
  assert.equal(dataset.journeys.length, 20);
  assert.equal(new Set(dataset.journeys.map((journey) => journey.case_id)).size, 20);
  assert.deepEqual(new Set(dataset.journeys.map((journey) => journey.action)), new Set(ACTIONS));
  assert.ok(dataset.journeys.every((journey) => journey.expected_status));
  assert.ok(dataset.journeys.every((journey) => journey.execution_path === "paired_loopback"
    || journey.execution_path === "in_process_bff_synthetic_state"));
});

test("the checked-in JSON Schema pins the v0 shape and twenty-journey count", async () => {
  const schema = JSON.parse(await readFile(new URL("../journey.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.journeys.minItems, 20);
  assert.equal(schema.properties.journeys.maxItems, 20);
  assert.equal(schema.properties.journeys.items.additionalProperties, false);
});

test("the release artifact contains only sanitized case outcomes and provenance", () => {
  const outcomes = ACTIONS.map((_, index) => ({
    case_id: `paired_v0_${String(index + 1).padStart(2, "0")}_test`,
    status: "passed",
    assertion_count: 2,
    raw_response: "must-not-appear",
  }));
  const artifact = createArtifact({
    dataset: { dataset_version: "paired-e2e-v0.1.0", journeys: outcomes },
    datasetHash: "a".repeat(64),
    repositories: {
      reference_store: { commit: "b".repeat(40), working_tree: "clean" },
      agent_core: { commit: "c".repeat(40), working_tree: "clean" },
    },
    outcomes,
    externalNetworkRequests: 0,
  });
  const serialized = JSON.stringify(artifact);
  assert.equal(artifact.summary.passed_count, 20);
  assert.deepEqual(Object.keys(artifact.journeys[0]), ["case_id", "status", "assertion_count"]);
  for (const forbidden of ["raw_response", "request_body", "response_body", "tenant_key", "must-not-appear"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
