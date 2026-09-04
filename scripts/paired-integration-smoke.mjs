import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadStartSandbox,
  resolveAgentCoreDirectory,
  startPlatform,
} from "./demo-platform.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Release lock: update only after the S1 owner supplies an accepted exact commit.
export const EXPECTED_AGENT_CORE = Object.freeze({
  commit: "9ff2de8de8582010d95d7c0632e1d126cb91f71a",
  statusSchemaSha256: "30b38d767874351e7c56976a9b707cb1aa6c6764940cd7d338338cb1d01c7211",
});
const STATUS_SCHEMA = "contracts/shopify-live-sandbox-status.v1.schema.json";
const GIT_OPERATIONS = Object.freeze([
  "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG",
  "rebase-merge", "rebase-apply", "sequencer", "index.lock", "HEAD.lock",
  "packed-refs.lock", "config.lock", "shallow.lock",
]);

export function readPairedGit(directory, args) {
  const result = spawnSync("git", [
    "--no-optional-locks", "-c", `safe.directory=${directory}`, "-C", directory, ...args,
  ], {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("paired_repository_provenance_unavailable");
  return String(result.stdout || "").trim();
}

async function pathExists(file) {
  try { await access(file); return true; }
  catch (error) {
    if (error?.code === "ENOENT") return false;
    throw new Error("paired_git_operation_check_failed");
  }
}

export async function assertAcceptedAgentCore(directory, {
  expected = EXPECTED_AGENT_CORE,
} = {}) {
  if (!/^[0-9a-f]{40}$/u.test(expected.commit)
    || !/^[0-9a-f]{64}$/u.test(expected.statusSchemaSha256)) {
    throw new Error("paired_agent_core_lock_invalid");
  }
  const commit = readPairedGit(directory, ["rev-parse", "HEAD"]);
  if (commit !== expected.commit) throw new Error("paired_agent_core_sha_mismatch");
  const tree = readPairedGit(directory, ["rev-parse", "HEAD^{tree}"]);
  if (!/^[0-9a-f]{40}$/u.test(tree)) throw new Error("paired_agent_core_tree_invalid");
  for (const operation of GIT_OPERATIONS) {
    const file = readPairedGit(directory, ["rev-parse", "--git-path", operation]);
    if (await pathExists(resolve(directory, file))) {
      throw new Error("paired_agent_core_git_operation_active");
    }
  }
  if (readPairedGit(directory, ["status", "--porcelain=v1", "--untracked-files=normal"])) {
    throw new Error("paired_agent_core_worktree_dirty");
  }
  const schema = await readFile(resolve(directory, STATUS_SCHEMA));
  const schemaSha256 = createHash("sha256").update(schema).digest("hex");
  if (schemaSha256 !== expected.statusSchemaSha256) {
    throw new Error("paired_agent_core_status_schema_mismatch");
  }
  return Object.freeze({
    commit,
    tree,
    working_tree: "clean",
    status_schema_sha256: schemaSha256,
  });
}

export async function runPairedSmoke({ args = process.argv.slice(2) } = {}) {
  const agentCoreDirectory = await resolveAgentCoreDirectory({ args });
  const accepted = await assertAcceptedAgentCore(agentCoreDirectory);
  // Only import after the identity gate. The Core sandbox is in memory and
  // serves loopback HTTP; never run setup/install/verify in the Core checkout.
  const startSandbox = await loadStartSandbox(agentCoreDirectory);
  const runtime = await startPlatform({
    startSandbox,
    sandboxPort: 0,
    demoPort: 0,
    host: "127.0.0.1",
  });

  try {
    const status = await new Promise((accept, reject) => {
      const child = spawn(process.execPath, [resolve(root, "scripts/integration-smoke.mjs")], {
        cwd: root,
        env: {
          ...process.env,
          AGENT_CORE_BASE_URL: runtime.sandbox.baseUrl,
          AGENT_CORE_TENANT_KEY: runtime.sandbox.token,
          STOREFRONT_ORIGIN: "https://sandbox-store.example.invalid",
        },
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => accept({ code, signal }));
    });
    if (status.code !== 0) {
      throw new Error(`paired_integration_smoke_failed:${status.signal || status.code}`);
    }
  } finally {
    await runtime.close();
    await assertAcceptedAgentCore(agentCoreDirectory);
  }
  console.log(`PASS: paired Agent Core + Reference Store integration (Core ${accepted.commit})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPairedSmoke().catch((error) => {
    const code = /^paired_[a-z0-9_]+$/u.test(error?.message || "")
      ? error.message : "paired_integration_smoke_failed";
    process.stderr.write(`FAIL: ${code}; no upstream or credential details were emitted.\n`);
    process.exitCode = 1;
  });
}
