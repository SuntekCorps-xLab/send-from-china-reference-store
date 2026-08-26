import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startDemo } from "../demo/server.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

function explicitAgentCoreArgument(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith("--agent-core=")) return argument.slice("--agent-core=".length);
    if (argument === "--agent-core") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--agent-core requires a directory");
      return value;
    }
  }
  return "";
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function candidateAgentCoreDirectories({ args = [], env = process.env, cwd = process.cwd(), repoRoot = repositoryRoot } = {}) {
  const explicit = explicitAgentCoreArgument(args);
  if (explicit) return [path.resolve(cwd, explicit)];
  if (String(env.AGENT_CORE_DIR || "").trim()) return [path.resolve(cwd, String(env.AGENT_CORE_DIR).trim())];
  return [
    path.resolve(repoRoot, "..", "send-from-china-agent-core"),
    path.resolve(repoRoot, "..", "github-agent-core"),
  ];
}

export async function resolveAgentCoreDirectory(options = {}) {
  const exists = options.exists || fileExists;
  const candidates = candidateAgentCoreDirectories(options);
  for (const directory of candidates) {
    if (await exists(path.join(directory, "sandbox", "server.mjs"))) return directory;
  }
  const inspected = candidates.map((directory) => path.join(directory, "sandbox", "server.mjs")).join(", ");
  throw new Error(`Agent Core sandbox entry was not found. Checked: ${inspected}`);
}

export async function loadStartSandbox(agentCoreDirectory, importer = (url) => import(url)) {
  const entry = path.join(agentCoreDirectory, "sandbox", "server.mjs");
  const module = await importer(pathToFileURL(entry).href);
  if (typeof module.startSandbox !== "function") {
    throw new Error(`${entry} must export startSandbox({ port, host, quiet })`);
  }
  return module.startSandbox;
}

function loopbackUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const loopback = url.hostname === "localhost"
      || url.hostname === "[::1]"
      || url.hostname === ["127", "0", "0", "1"].join(".");
    return loopback
      && ["http:", "https:"].includes(url.protocol)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && url.pathname === "/";
  } catch {
    return false;
  }
}

function loopbackHost(value) {
  const host = String(value || "").trim().toLowerCase();
  if (host === "localhost" || host === "::1" || host === ["127", "0", "0", "1"].join(".")) return host;
  throw new Error("The local platform sandbox may bind only to a loopback host");
}

function validSandbox(runtime) {
  return runtime
    && typeof runtime.baseUrl === "string"
    && loopbackUrl(runtime.baseUrl)
    && typeof runtime.token === "string"
    && runtime.token
    && typeof runtime.close === "function";
}

async function closeRuntimes(demo, sandbox) {
  let firstError;
  if (demo?.close) {
    try {
      await demo.close();
    } catch (error) {
      firstError = error;
    }
  }
  if (sandbox?.close) {
    try {
      await sandbox.close();
    } catch (error) {
      firstError ||= error;
    }
  }
  if (firstError) throw firstError;
}

export async function startPlatform(options = {}) {
  const host = loopbackHost(options.host || ["127", "0", "0", "1"].join("."));
  const sandboxPort = Number(options.sandboxPort ?? 8787);
  const demoPort = Number(options.demoPort ?? 4173);
  const startSandbox = options.startSandbox;
  const startReferenceDemo = options.startReferenceDemo || startDemo;
  if (typeof startSandbox !== "function") throw new Error("startPlatform requires startSandbox");

  let sandbox;
  let demo;
  try {
    sandbox = await startSandbox({ port: sandboxPort, host, quiet: true });
    if (!validSandbox(sandbox)) {
      throw new Error("Agent Core startSandbox returned an invalid runtime descriptor");
    }
    demo = await startReferenceDemo({
      mode: "connected",
      port: demoPort,
      host,
      quiet: true,
      verifyConnected: true,
      agentCoreBaseUrl: sandbox.baseUrl,
      agentCoreToken: sandbox.token,
      storefrontOrigin: "https://sandbox-store.example.invalid",
    });
  } catch (error) {
    await closeRuntimes(demo, sandbox).catch(() => {});
    throw error;
  }

  let closed = false;
  return {
    sandbox,
    demo,
    url: demo.baseUrl,
    async close() {
      if (closed) return;
      closed = true;
      await closeRuntimes(demo, sandbox);
    },
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const agentCoreDirectory = await resolveAgentCoreDirectory({ args });
  const startSandbox = await loadStartSandbox(agentCoreDirectory);
  const runtime = await startPlatform({
    startSandbox,
    sandboxPort: Number(process.env.AGENT_CORE_SANDBOX_PORT || 8787),
    demoPort: Number(process.env.DEMO_PORT || 4173),
    host: "127.0.0.1",
  });

  process.stdout.write([
    `Send From China local platform sandbox: ${runtime.url}`,
    `Agent Core: ${runtime.sandbox.baseUrl}`,
    "Mode: connected local sandbox · synthetic snapshot · illustrative only",
    "Boundaries: non-purchasable · no shipping rates · no commerce writes",
    `Agent Core source: ${agentCoreDirectory}`,
    "Press Ctrl+C to stop both local servers.",
    "",
  ].join("\n"));

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await runtime.close();
    } catch (error) {
      process.stderr.write(`Sandbox shutdown warning: ${error?.message || "unknown_error"}\n`);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`Unable to start the local platform sandbox: ${error?.message || "unknown_error"}\n`);
    process.exitCode = 1;
  });
}
