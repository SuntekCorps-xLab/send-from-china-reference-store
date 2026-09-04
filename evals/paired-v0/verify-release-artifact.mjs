import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAgentCoreDirectory } from "../../scripts/demo-platform.mjs";
import { assertAcceptedAgentCore } from "../../scripts/paired-integration-smoke.mjs";
import {
  repositoryDescriptor,
  resolvePairedArtifactPath,
  validateReleaseArtifact,
} from "./run.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith("--")) {
    throw new Error("paired_release_verifier_arguments_invalid");
  }
  return args[index + 1];
}

export async function verifyReleaseArtifact({ artifactPath, agentCoreDirectory }) {
  const observedRepositories = {
    reference_store: repositoryDescriptor(root),
    agent_core: await assertAcceptedAgentCore(agentCoreDirectory),
  };
  const bytes = await readFile(resolvePairedArtifactPath(artifactPath));
  const artifact = validateReleaseArtifact(JSON.parse(bytes.toString("utf8")), observedRepositories);
  return { artifact, observedRepositories };
}

async function main() {
  const args = process.argv.slice(2);
  const artifactPath = argumentValue(args, "--artifact");
  const agentCoreDirectory = await resolveAgentCoreDirectory({ args, cwd: root });
  const { artifact } = await verifyReleaseArtifact({ artifactPath, agentCoreDirectory });
  process.stdout.write(`PASS: Core-compatible paired release artifact ${artifact.execution.passed}/${artifact.execution.journeys}; App Proxy live verified=false.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write("FAIL: paired release artifact is invalid; no repository path, payload, or credential details were emitted.\n");
    process.exitCode = 1;
  });
}
