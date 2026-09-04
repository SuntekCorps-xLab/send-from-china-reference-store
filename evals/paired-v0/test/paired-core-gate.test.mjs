import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { assertAcceptedAgentCore } from "../../../scripts/paired-integration-smoke.mjs";
import { resolvePairedArtifactPath } from "../run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const build = path.resolve(root, "build");
const schemaPath = "contracts/shopify-live-sandbox-status.v1.schema.json";

function git(directory, ...args) {
  const result = spawnSync("git", ["-C", directory, ...args], {
    encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 0, "local fixture Git command must succeed");
  return result.stdout.trim();
}

function commit(directory) {
  git(directory, "add", "--", ".");
  git(directory, "-c", "user.name=Paired gate test",
    "-c", "user.email=paired-test@example.invalid", "commit", "--quiet", "-m", "Fixture");
  return git(directory, "rev-parse", "HEAD");
}

async function fixture(context) {
  await mkdir(build, { recursive: true });
  const directory = await mkdtemp(path.join(build, "paired-core-gate-"));
  context.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), build, "fixture cleanup stays within Reference build");
    await rm(resolved, { recursive: true, force: true });
  });
  await mkdir(path.join(directory, "contracts"));
  const bytes = Buffer.from('{"contract":"public-test-fixture"}\n');
  await writeFile(path.join(directory, schemaPath), bytes);
  git(directory, "init", "--quiet");
  const expected = {
    commit: commit(directory),
    statusSchemaSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  return { directory, expected };
}

test("the paired gate accepts one exact clean Core revision without refreshing its index", async (context) => {
  const { directory, expected } = await fixture(context);
  const index = path.join(directory, ".git", "index");
  const before = await stat(index);
  const future = new Date(Date.now() + 10_000);
  await utimes(path.join(directory, schemaPath), future, future);
  const result = await assertAcceptedAgentCore(directory, { expected });
  assert.equal(result.commit, expected.commit);
  assert.equal(result.working_tree, "clean");
  assert.equal(result.status_schema_sha256, expected.statusSchemaSha256);
  assert.match(result.tree, /^[0-9a-f]{40}$/u);
  assert.equal((await stat(index)).mtimeMs, before.mtimeMs,
    "read-only provenance must leave the paired checkout index unchanged");
});

test("a different exact Core commit is rejected before any sandbox import", async (context) => {
  const { directory, expected } = await fixture(context);
  await assert.rejects(assertAcceptedAgentCore(directory, {
    expected: { ...expected, commit: "0".repeat(40) },
  }), /paired_agent_core_sha_mismatch/);
});

test("tracked and untracked Core modifications both fail the paired gate", async (context) => {
  const { directory, expected } = await fixture(context);
  const schema = path.join(directory, schemaPath);
  const original = await readFile(schema);
  await writeFile(schema, "{}\n");
  await assert.rejects(assertAcceptedAgentCore(directory, { expected }),
    /paired_agent_core_worktree_dirty/);
  await writeFile(schema, original);
  await writeFile(path.join(directory, "untracked-fixture.txt"), "fixture\n");
  await assert.rejects(assertAcceptedAgentCore(directory, { expected }),
    /paired_agent_core_worktree_dirty/);
});

test("an in-progress Git operation or index writer blocks a clean Core commit", async (context) => {
  const { directory, expected } = await fixture(context);
  for (const operation of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "index.lock"]) {
    const marker = path.join(directory, ".git", operation);
    await writeFile(marker, expected.commit);
    await assert.rejects(assertAcceptedAgentCore(directory, { expected }),
      /paired_agent_core_git_operation_active/);
    await rm(marker);
  }
});

test("a clean accepted commit with a changed status schema needs a reviewed schema lock", async (context) => {
  const { directory, expected } = await fixture(context);
  await writeFile(path.join(directory, schemaPath), '{"contract":"changed"}\n');
  const changedCommit = commit(directory);
  await assert.rejects(assertAcceptedAgentCore(directory, {
    expected: { ...expected, commit: changedCommit },
  }), /paired_agent_core_status_schema_mismatch/);
});

test("paired artifacts cannot target Core or any path outside Reference build", () => {
  assert.equal(resolvePairedArtifactPath("build/paired-e2e-v0/artifact.json"),
    path.join(build, "paired-e2e-v0", "artifact.json"));
  for (const value of ["../agent-core/build/artifact.json", "docs/artifact.json", "build/../artifact.json", build]) {
    assert.throws(() => resolvePairedArtifactPath(value),
      /paired_artifact_must_stay_in_reference_build/);
  }
});