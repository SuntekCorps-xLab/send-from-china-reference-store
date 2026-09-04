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

export function candidateShopifyAgentCoreDirectories({
  args = [], env = process.env, cwd = process.cwd(), repoRoot = repositoryRoot,
} = {}) {
  const explicit = explicitAgentCoreArgument(args);
  if (explicit) return [path.resolve(cwd, explicit)];
  if (String(env.AGENT_CORE_DIR || "").trim()) {
    return [path.resolve(cwd, String(env.AGENT_CORE_DIR).trim())];
  }
  return [
    path.resolve(repoRoot, "..", "agent-core-shopify-sandbox-worktree"),
    path.resolve(repoRoot, "..", "send-from-china-agent-core"),
    path.resolve(repoRoot, "..", "github-agent-core"),
  ];
}

export async function resolveShopifyAgentCoreDirectory(options = {}) {
  const exists = options.exists || fileExists;
  const candidates = candidateShopifyAgentCoreDirectories(options);
  for (const directory of candidates) {
    if (await exists(path.join(directory, "sandbox", "shopify-server.mjs"))) return directory;
  }
  throw new Error("shopify_agent_core_entry_not_found");
}

export async function loadStartVerifiedShopifySandbox(
  directory,
  importer = (url) => import(url),
) {
  const entry = path.join(directory, "sandbox", "shopify-server.mjs");
  const module = await importer(pathToFileURL(entry).href);
  if (typeof module.startVerifiedShopifySandbox !== "function") {
    throw new Error("shopify_agent_core_export_missing");
  }
  return module.startVerifiedShopifySandbox;
}

function exactLoopbackBase(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" && url.hostname === "127.0.0.1"
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  } catch {
    return false;
  }
}

function explicitUrlPort(value) {
  const authority = String(value || "").trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//iu, "").split(/[/?#]/u, 1)[0];
  const host = authority.slice(authority.lastIndexOf("@") + 1);
  return host.startsWith("[") ? /\]:\d+$/u.test(host) : /:\d+$/u.test(host);
}

function publicStorefrontOrigin(value) {
  try {
    const url = new URL(String(value || ""));
    const hostname = url.hostname.toLowerCase();
    const privateSuffix = [
      "localhost", "local", "internal", "corp", "lan", "localdomain", "home.arpa",
    ].some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
    const publicDns = hostname.includes(".") && !hostname.endsWith(".") && !privateSuffix
      && !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname) && !hostname.includes(":")
      && hostname.split(".").every((label) => (
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)
      ));
    return url.protocol === "https:" && publicDns && !url.username && !url.password
      && !url.port && !explicitUrlPort(value) && url.pathname === "/"
      && !url.search && !url.hash ? url.origin : "";
  } catch {
    return "";
  }
}

function configuredStorefrontOrigin(environment, explicit) {
  const configured = String(explicit || environment.STOREFRONT_ORIGIN || "").trim();
  if (configured) return publicStorefrontOrigin(configured);
  const domain = String(environment.SHOPIFY_STORE_DOMAIN || "").trim().toLowerCase();
  return publicStorefrontOrigin(domain ? `https://${domain}` : "");
}

function publicFailure(status) {
  const state = String(status?.credential_state || "service_unavailable").toLowerCase();
  return [
    "credential_missing", "authentication_failed", "permission_required",
    "quota_exceeded", "service_unavailable",
  ].includes(state) ? state : "service_unavailable";
}

async function closeRuntimes(demo, sandbox) {
  let firstError;
  for (const runtime of [demo, sandbox]) {
    try { await runtime?.close?.(); }
    catch (error) { firstError ||= error; }
  }
  if (firstError) throw firstError;
}

export async function startShopifyPlatform(options = {}) {
  const host = String(options.host || "127.0.0.1").trim();
  if (host !== "127.0.0.1") throw new Error("shopify_demo_requires_127_0_0_1");
  const environment = options.environment || process.env;
  const startVerified = options.startVerifiedShopifySandbox;
  const startReferenceDemo = options.startReferenceDemo || startDemo;
  if (typeof startVerified !== "function") throw new Error("start_verified_shopify_sandbox_required");
  const storefrontOrigin = configuredStorefrontOrigin(environment, options.storefrontOrigin);
  if (!storefrontOrigin) throw new Error("shopify_storefront_origin_required");

  let sandbox;
  let demo;
  let status;
  try {
    const started = await startVerified({
      port: Number(options.sandboxPort ?? 8787),
      host,
      environment,
    });
    status = started?.status;
    sandbox = started?.sandbox;
    if (status?.mode !== "shopify_read_only" || status?.verified !== true || !sandbox) {
      throw new Error(`shopify_sandbox_not_ready:${publicFailure(status)}`);
    }
    if (!exactLoopbackBase(sandbox.baseUrl) || typeof sandbox.close !== "function") {
      throw new Error("invalid_shopify_sandbox_descriptor");
    }
    demo = await startReferenceDemo({
      mode: "shopify",
      port: Number(options.demoPort ?? 4173),
      host,
      quiet: true,
      verifyRuntime: true,
      agentCoreSandboxUrl: sandbox.baseUrl,
      ...(String(sandbox.token || "").trim()
        ? { agentCoreSandboxToken: String(sandbox.token).trim() }
        : {}),
      storefrontOrigin,
    });
  } catch (error) {
    await closeRuntimes(demo, sandbox).catch(() => {});
    throw error;
  }

  let closed = false;
  return Object.freeze({
    status,
    sandbox,
    demo,
    url: demo.baseUrl,
    async close() {
      if (closed) return;
      closed = true;
      await closeRuntimes(demo, sandbox);
    },
  });
}

async function runCli() {
  const args = process.argv.slice(2);
  const directory = await resolveShopifyAgentCoreDirectory({ args });
  const startVerifiedShopifySandbox = await loadStartVerifiedShopifySandbox(directory);
  const runtime = await startShopifyPlatform({
    startVerifiedShopifySandbox,
    environment: process.env,
    sandboxPort: Number(process.env.AGENT_CORE_SANDBOX_PORT || 8787),
    demoPort: Number(process.env.DEMO_PORT || 4173),
    host: "127.0.0.1",
  });
  process.stdout.write([
    `Reference Store Shopify read-only sandbox: ${runtime.url}`,
    "Mode: Shopify read-only · writes disabled · non-transactional",
    "Credentials remain in the Agent Core/BFF server environment.",
    `Agent Core source: ${directory}`,
    "Press Ctrl+C to stop both local servers.",
    "",
  ].join("\n"));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await runtime.close();
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`Unable to start Shopify read-only sandbox: ${error?.message || "service_unavailable"}\n`);
    process.exitCode = 1;
  });
}
