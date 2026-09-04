import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { ACTIONS, loadDataset } from "../dataset.mjs";
import {
  createArtifact,
  createReleaseArtifact,
  validateReleaseArtifact,
} from "../run.mjs";

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
      reference_store: { commit: "b".repeat(40), tree: "d".repeat(40), working_tree: "clean" },
      agent_core: { commit: "c".repeat(40), tree: "e".repeat(40), working_tree: "clean" },
    },
    outcomes,
    externalNetworkRequests: 0,
  });
  const serialized = JSON.stringify(artifact);
  assert.equal(artifact.summary.passed_count, 20);
  assert.match(artifact.repositories.reference_store.tree, /^[0-9a-f]{40}$/u);
  assert.match(artifact.repositories.agent_core.tree, /^[0-9a-f]{40}$/u);
  assert.deepEqual(Object.keys(artifact.journeys[0]), ["case_id", "status", "assertion_count"]);
  for (const forbidden of ["raw_response", "request_body", "response_body", "tenant_key", "must-not-appear"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

function releaseFixture() {
  const outcomes = ACTIONS.map((_, index) => ({
    case_id: `paired_v0_${String(index + 1).padStart(2, "0")}_release`,
    status: "passed",
    assertion_count: 2,
  }));
  const repositories = {
    reference_store: { commit: "b".repeat(40), tree: "d".repeat(40), working_tree: "clean" },
    agent_core: {
      commit: "c".repeat(40), tree: "e".repeat(40), working_tree: "clean",
      status_schema_sha256: "f".repeat(64),
    },
  };
  return { outcomes, repositories };
}

test("the Core-compatible release artifact binds observed clean identities and exactly 20 passes", () => {
  const { outcomes, repositories } = releaseFixture();
  const artifact = createReleaseArtifact({ repositories, outcomes, externalNetworkRequests: 0 });
  assert.equal(validateReleaseArtifact(artifact, repositories), artifact);
  assert.equal(artifact.schema_version, "agent-core-reference-store-paired-e2e/v1");
  assert.deepEqual(artifact.execution, { mode: "synthetic", journeys: 20, passed: 20, failed: 0 });
  assert.equal(artifact.gates.app_proxy_live_verified, false);
  assert.equal(artifact.agent_core.commit, repositories.agent_core.commit);
  assert.equal(artifact.reference_store.tree, repositories.reference_store.tree);
  assert.doesNotMatch(JSON.stringify(artifact), /status_schema_sha256|case_id|query|response|token/u);
});

test("release evidence fails closed on identity, count, private field, duplicate, dirt, or failed gates", () => {
  const { outcomes, repositories } = releaseFixture();
  const artifact = createReleaseArtifact({ repositories, outcomes, externalNetworkRequests: 0 });
  assert.throws(() => validateReleaseArtifact({ ...artifact, private_field: "no" }, repositories), /invalid/u);
  assert.throws(() => validateReleaseArtifact(artifact, {
    ...repositories,
    agent_core: { ...repositories.agent_core, commit: "a".repeat(40) },
  }), /invalid/u);
  assert.throws(() => validateReleaseArtifact({
    ...artifact,
    execution: { ...artifact.execution, journeys: 19, passed: 19 },
  }, repositories), /invalid/u);
  assert.throws(() => createReleaseArtifact({
    repositories,
    outcomes: outcomes.slice(0, 19),
    externalNetworkRequests: 0,
  }), /count/u);
  assert.throws(() => createReleaseArtifact({
    repositories,
    outcomes: outcomes.map((item, index) => index === 19 ? { ...item, case_id: outcomes[0].case_id } : item),
    externalNetworkRequests: 0,
  }), /duplicate/u);
  assert.throws(() => createReleaseArtifact({
    repositories: { ...repositories, reference_store: { ...repositories.reference_store, working_tree: "dirty" } },
    outcomes,
    externalNetworkRequests: 0,
  }), /repository/u);
  assert.throws(() => createReleaseArtifact({
    repositories,
    outcomes,
    externalNetworkRequests: 1,
  }), /gate/u);
});

test("the Core-compatible release schema recursively closes every object", async () => {
  const schema = JSON.parse(await readFile(new URL("../release-artifact.schema.json", import.meta.url), "utf8"));
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") assert.equal(node.additionalProperties, false);
    for (const value of Object.values(node)) visit(value);
  };
  visit(schema);
  assert.equal(schema.properties.execution.properties.journeys.const, 20);
  assert.equal(schema.properties.gates.properties.app_proxy_live_verified.const, false);
});
