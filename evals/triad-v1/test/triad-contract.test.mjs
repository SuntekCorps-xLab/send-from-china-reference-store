import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { link, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { EXPECTED_AGENT_CORE_SHA, EXPECTED_MINI_SHA, loadDataset, validateDataset } from "../dataset.mjs";
import {
  ARTIFACT_SCHEMA_VERSION,
  FIXTURE_QUERIES,
  createArtifact,
  createMiniClientAdapter,
  installNetworkGuard,
  parseArguments,
  repositoryDescriptor,
  writeArtifactNew,
} from "../run.mjs";

const SHA_A = "66528615e57886829ed695727e85e08b0cea3c90";
const SHA_B = EXPECTED_AGENT_CORE_SHA;
const SHA_C = "c".repeat(40);

function sampleArtifact(overrides = {}) {
  return createArtifact({
    repositories: {
      mini_suntek: { commit: SHA_A },
      agent_core: { commit: SHA_B },
      reference_store: { commit: SHA_C },
    },
    journeyCount: 20,
    attemptedCount: 20,
    passedCount: 20,
    assertionCount: 240,
    firstFailureOrdinal: null,
    network: { allowed: 63, nonLoopback: 0, commerceWrites: 0, deniedEndpoints: 0, redirects: 0 },
    productionRecords: 0,
    ...overrides,
  });
}

function cliArgs(output) {
  const checkoutRoot = path.join(tmpdir(), "triad-checkouts");
  return [
    "--mini", path.join(checkoutRoot, "mini-suntek"),
    "--mini-sha", SHA_A,
    "--agent-core", path.join(checkoutRoot, "agent-core"),
    "--agent-core-sha", SHA_B,
    "--reference-store-sha", SHA_C,
    "--output", output,
  ];
}

test("the triad dataset pins exactly twenty unique result and miss journeys", async () => {
  const { dataset } = await loadDataset();
  assert.equal(dataset.journeys.length, 20);
  assert.equal(dataset.expected_mini_sha, EXPECTED_MINI_SHA);
  assert.equal(dataset.expected_agent_core_sha, EXPECTED_AGENT_CORE_SHA);
  assert.equal(new Set(dataset.journeys.map((journey) => journey.case_id)).size, 20);
  assert.equal(new Set(dataset.journeys.map((journey) => journey.fixture)).size, 20);
  assert.equal(dataset.journeys.filter((journey) => journey.expected_status === "results").length, 10);
  assert.equal(dataset.journeys.filter((journey) => journey.expected_status === "no_match").length, 10);
  assert.deepEqual(new Set(dataset.journeys.map((journey) => journey.fixture)), new Set(Object.keys(FIXTURE_QUERIES)));
  assert.throws(() => validateDataset({ ...dataset, journeys: dataset.journeys.slice(1) }), /exactly 20/u);
});

test("the checked-in schemas reject unbounded dataset and artifact fields", async () => {
  const journeySchema = JSON.parse(await readFile(new URL("../journey.schema.json", import.meta.url), "utf8"));
  const artifactSchema = JSON.parse(await readFile(new URL("../artifact.schema.json", import.meta.url), "utf8"));
  assert.equal(journeySchema.additionalProperties, false);
  assert.equal(journeySchema.properties.journeys.minItems, 20);
  assert.equal(journeySchema.properties.journeys.maxItems, 20);
  assert.equal(journeySchema.properties.journeys.items.additionalProperties, false);
  assert.equal(journeySchema.properties.expected_mini_sha.const, EXPECTED_MINI_SHA);
  assert.equal(journeySchema.properties.expected_agent_core_sha.const, EXPECTED_AGENT_CORE_SHA);
  assert.equal(artifactSchema.additionalProperties, false);
  assert.equal(artifactSchema.properties.repositories.additionalProperties, false);
  assert.equal(artifactSchema.properties.aggregate.additionalProperties, false);
  assert.equal(artifactSchema.properties.authorizes_release.const, false);
  assert.equal(artifactSchema.properties.full_triad_e2e.const, false);
  assert.equal(artifactSchema.properties.aggregate.properties.guarded_fetch_non_loopback_request_count.const, 0);
  assert.equal(artifactSchema.properties.aggregate.properties.production_record_count.const, 0);
  assert.equal(artifactSchema.properties.aggregate.properties.guarded_fetch_commerce_write_count.const, 0);
  assert.equal(artifactSchema.properties.aggregate.properties.guarded_fetch_redirect_count.const, 0);
});

test("CLI parsing requires both repository paths, all three exact SHAs, and an external absolute output", () => {
  const outputRoot = path.join(tmpdir(), "triad-evidence");
  const parsed = parseArguments(cliArgs(path.join(outputRoot, "run-001.json")));
  assert.equal(parsed.miniSha, SHA_A);
  assert.equal(parsed.agentCoreSha, SHA_B);
  assert.equal(parsed.referenceStoreSha, SHA_C);
  assert.ok(path.isAbsolute(parsed.output));
  assert.throws(() => parseArguments(cliArgs("relative/run.json")), /absolute/u);
  assert.throws(
    () => parseArguments(cliArgs(`${outputRoot}${path.sep}..${path.sep}run.json`)),
    /traversal/u,
  );
  assert.throws(() => parseArguments(cliArgs(path.join(outputRoot, "run.json")).slice(0, -2)), /required/u);
  const abbreviated = cliArgs(path.join(outputRoot, "run.json"));
  abbreviated[3] = "a".repeat(12);
  assert.throws(() => parseArguments(abbreviated), /exact lowercase/u);
});

test("repository provenance requires an exact clean root checkout", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "triad-git-"));
  const run = (...args) => spawnSync("git", ["-C", directory, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(run("init").status, 0);
  await writeFile(path.join(directory, "fixture.txt"), "synthetic\n", "utf8");
  assert.equal(run("add", "fixture.txt").status, 0);
  assert.equal(run("-c", "user.name=Triad Test", "-c", "user.email=triad@example.invalid", "commit", "-m", "fixture").status, 0);
  const commit = String(run("rev-parse", "HEAD").stdout).trim();
  const clean = await repositoryDescriptor(directory, commit, "fixture");
  assert.equal(clean.commit, commit);
  assert.equal(run("update-index", "--assume-unchanged", "fixture.txt").status, 0);
  await writeFile(path.join(directory, "fixture.txt"), "hidden mutation\n", "utf8");
  await assert.rejects(repositoryDescriptor(directory, commit, "fixture"), /index flags/u);
  assert.equal(run("update-index", "--no-assume-unchanged", "fixture.txt").status, 0);
  await writeFile(path.join(directory, "fixture.txt"), "synthetic\n", "utf8");
  assert.equal(run("update-index", "--skip-worktree", "fixture.txt").status, 0);
  await writeFile(path.join(directory, "fixture.txt"), "hidden skip mutation\n", "utf8");
  await assert.rejects(repositoryDescriptor(directory, commit, "fixture"), /index flags/u);
  assert.equal(run("update-index", "--no-skip-worktree", "fixture.txt").status, 0);
  await writeFile(path.join(directory, "fixture.txt"), "synthetic\n", "utf8");
  await writeFile(path.join(directory, "fixture.txt"), "replacement tree\n", "utf8");
  assert.equal(run("add", "fixture.txt").status, 0);
  assert.equal(run("-c", "user.name=Triad Test", "-c", "user.email=triad@example.invalid", "commit", "-m", "replacement").status, 0);
  const replacementCommit = String(run("rev-parse", "HEAD").stdout).trim();
  const branch = String(run("symbolic-ref", "--short", "HEAD").stdout).trim();
  assert.equal(run("replace", commit, replacementCommit).status, 0);
  assert.equal(run("update-ref", `refs/heads/${branch}`, commit).status, 0);
  await assert.rejects(repositoryDescriptor(directory, commit, "fixture"), /replacement refs/u);
  assert.equal(run("replace", "-d", commit).status, 0);
  assert.equal(run("reset", "--hard", commit).status, 0);
  await writeFile(path.join(directory, "untracked.txt"), "dirty\n", "utf8");
  await assert.rejects(repositoryDescriptor(directory, commit, "fixture"), /must be clean/u);
  await assert.rejects(repositoryDescriptor(directory, SHA_A, "fixture"), /explicit SHA/u);
});

test("the committed Mini client contract can be evaluated without a browser or network", () => {
  const source = String.raw`
    const fixtures = Object.freeze({
      desk: [
        { title: "Modular desk organizer", summary: "illustrative" },
        { title: "Fold-flat desk tray", summary: "illustrative" },
      ],
    });
    const input = document.querySelector("#query");
    const results = document.querySelector("[data-results]");
    const title = document.querySelector("[data-result-title]");
    const sourcing = document.querySelector("[data-sourcing]");
    const confirm = document.querySelector("[data-confirm]");
    const sourceButton = document.querySelector("[data-source]");
    const request = document.querySelector("[data-request]");
    const timeline = document.querySelector("[data-timeline]");
    function search() {
      const value = input.value.trim().slice(0, 120);
      const key = /desk|organizer|tray/iu.test(value) ? "desk" : "miss";
      request.textContent = JSON.stringify({ mode: "online_synthetic_preview", product_identity: value, external_call: false });
      confirm.checked = false;
      sourceButton.disabled = true;
      if (key === "miss") {
        title.textContent = "No catalog match";
        results.innerHTML = "";
        sourcing.hidden = false;
        return;
      }
      title.textContent = "Catalog match";
      results.innerHTML = fixtures.desk.map((product) => '<article class="product-card"><small>ILLUSTRATIVE MATCH</small><h3>' + product.title + '</h3><em>NO PURCHASE URL</em></article>').join("");
      sourcing.hidden = true;
      timeline.querySelectorAll("span");
    }
    document.querySelector("[data-search]").addEventListener("click", search);
    input.addEventListener("keydown", () => {});
    for (const suggestion of document.querySelectorAll("[data-suggestion]")) suggestion.addEventListener("click", search);
    search();
  `;
  const adapter = createMiniClientAdapter(source);
  const match = adapter.search("desk organizer");
  assert.equal(match.status, "results");
  assert.equal(match.result_count, 2);
  assert.equal(match.illustrative_count, 2);
  assert.equal(match.no_purchase_count, 2);
  assert.equal(match.request_contract.external_call, false);
  const miss = adapter.search("quartz violin umbrella");
  assert.equal(miss.status, "no_match");
  assert.equal(miss.result_count, 0);
});

test("the fetch guard requires exact loopback endpoints and blocks writes and redirects", async () => {
  const nativeFetch = async (input, init) => {
    assert.equal(init.redirect, "manual");
    const url = new URL(String(input));
    return url.pathname === "/redirect"
      ? new Response(null, { status: 302, headers: { location: "https://example.invalid/escape" } })
      : new Response(url.hostname);
  };
  const guard = installNetworkGuard(nativeFetch);
  try {
    guard.allowEndpoint("GET", "http://127.0.0.1:4321/demo/");
    guard.allowEndpoint("GET", "http://127.0.0.1:4321/redirect");
    const local = await fetch("http://127.0.0.1:4321/demo/");
    assert.equal(await local.text(), "127.0.0.1");
    await assert.rejects(fetch("https://example.invalid/demo/"), /non-loopback/u);
    await assert.rejects(fetch("http://127.0.0.1:4321/api/order", { method: "POST" }), /commerce write/u);
    await assert.rejects(fetch("http://127.0.0.1:4321/not-allowed"), /exact loopback allowlist/u);
    await assert.rejects(fetch("http://127.0.0.1:4321/redirect"), /redirect/u);
    assert.deepEqual(guard.counts, {
      allowed: 1,
      nonLoopback: 1,
      commerceWrites: 1,
      deniedEndpoints: 1,
      redirects: 1,
    });
  } finally {
    guard.restore();
  }
});

test("the artifact contains aggregate counters and three SHAs but no journey data", () => {
  const artifact = sampleArtifact();
  assert.equal(artifact.schema_version, ARTIFACT_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(artifact).sort(), [
    "aggregate",
    "authorizes_live_preview",
    "authorizes_release",
    "claim_scope",
    "full_triad_e2e",
    "generated_at",
    "non_fetch_network_observation",
    "observation_scope",
    "repositories",
    "schema_version",
    "vm_execution_boundary",
  ]);
  assert.deepEqual(artifact.repositories, {
    mini_suntek: SHA_A,
    agent_core: SHA_B,
    reference_store: SHA_C,
  });
  assert.equal(artifact.aggregate.status, "contract_passed");
  assert.equal(artifact.authorizes_release, false);
  assert.equal(artifact.full_triad_e2e, false);
  const serialized = JSON.stringify(artifact);
  for (const forbidden of ["prompt", "query", "response", "product_id", "public_id", "case_id", "credential"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  const failed = sampleArtifact({ passedCount: 19, firstFailureOrdinal: 4 });
  assert.equal(failed.aggregate.status, "contract_failed");
  assert.equal(failed.aggregate.first_failure_ordinal, 4);
});

test("artifact writing is repository-external, no-clobber, and retains the first failed run", async () => {
  const external = await mkdtemp(path.join(tmpdir(), "triad-artifact-"));
  const repository = await mkdtemp(path.join(tmpdir(), "triad-repository-"));
  const output = path.join(external, "new", "failed-run.json");
  const first = sampleArtifact({ passedCount: 19, firstFailureOrdinal: 2 });
  await writeArtifactNew(output, first, [repository]);
  const original = await readFile(output, "utf8");
  await assert.rejects(writeArtifactNew(output, sampleArtifact(), [repository]), /EEXIST/u);
  assert.equal(await readFile(output, "utf8"), original);
  await assert.rejects(
    writeArtifactNew(path.join(repository, "artifact.json"), sampleArtifact(), [repository]),
    /outside every repository/u,
  );
  await assert.rejects(
    writeArtifactNew([external, "new", "..", "traversal.json"].join(path.sep), sampleArtifact(), [repository]),
    /traversal/u,
  );
});

test("existing symlink and hardlink artifact targets are never followed or replaced", async (context) => {
  const external = await mkdtemp(path.join(tmpdir(), "triad-links-"));
  const repository = await mkdtemp(path.join(tmpdir(), "triad-link-repository-"));
  const original = path.join(external, "original.json");
  await writeFile(original, "original\n", "utf8");
  const hardlink = path.join(external, "hardlink.json");
  await link(original, hardlink);
  await assert.rejects(writeArtifactNew(hardlink, sampleArtifact(), [repository]), /EEXIST/u);
  const symlinkPath = path.join(external, "symlink.json");
  try {
    await symlink(original, symlinkPath, "file");
  } catch (error) {
    if (error?.code === "EPERM") {
      context.diagnostic("symlink creation is not permitted for this Windows test identity");
      return;
    }
    throw error;
  }
  await assert.rejects(writeArtifactNew(symlinkPath, sampleArtifact(), [repository]), /EEXIST/u);
  assert.equal(await readFile(original, "utf8"), "original\n");
});
