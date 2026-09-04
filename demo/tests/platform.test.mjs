import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  candidateAgentCoreDirectories,
  isDirectInvocation,
  resolveAgentCoreDirectory,
  startPlatform,
} from "../../scripts/demo-platform.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..", "..");

test("the platform preflight honors an explicit Agent Core directory before environment or siblings", async () => {
  const cwd = path.resolve("fixture-workspace", "reference-store");
  const expected = path.resolve(cwd, "..", "custom-agent-core");
  const candidates = candidateAgentCoreDirectories({
    args: ["--agent-core", "../custom-agent-core"],
    env: { AGENT_CORE_DIR: "../ignored-agent-core" },
    cwd,
  });
  assert.deepEqual(candidates, [expected]);

  const resolved = await resolveAgentCoreDirectory({
    args: ["--agent-core=../custom-agent-core"],
    cwd,
    exists: async (file) => file === path.join(expected, "sandbox", "server.mjs"),
  });
  assert.equal(resolved, expected);
});

test("the platform preflight checks public-clone and workspace sibling names", () => {
  const repoRoot = path.resolve("fixture-workspace", "reference-store");
  const candidates = candidateAgentCoreDirectories({ args: [], env: {}, repoRoot });
  assert.deepEqual(candidates, [
    path.resolve(repoRoot, "..", "send-from-china-agent-core"),
    path.resolve(repoRoot, "..", "github-agent-core"),
  ]);
});

test("direct invocation compares canonical entrypoint identities", async () => {
  const physical = path.join(repositoryRoot, "scripts", "demo-platform.mjs");
  const alias = path.join(repositoryRoot, "junction-alias", "scripts", "demo-platform.mjs");
  const canonicalize = async (value) => value.includes("junction-alias") ? physical : value;
  assert.equal(await isDirectInvocation(alias, physical, canonicalize), true);
  assert.equal(await isDirectInvocation(path.join(repositoryRoot, "other.mjs"), physical, canonicalize), false);
});

test("the platform CLI fails visibly instead of succeeding silently through a directory alias", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "reference-platform-entry-"));
  const alias = path.join(temporary, "reference-store-alias");
  try {
    await symlink(repositoryRoot, alias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (error?.code === "EPERM") {
      context.diagnostic("directory alias creation is not permitted for this Windows test identity");
      return;
    }
    throw error;
  }

  try {
    const missingCore = path.join(temporary, "missing-agent-core");
    const child = spawnSync(process.execPath, [
      path.join(alias, "scripts", "demo-platform.mjs"),
      "--agent-core",
      missingCore,
    ], {
      cwd: alias,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(child.status, 1, child.stderr || child.stdout);
    assert.match(child.stderr, /Unable to start the local platform sandbox/u);
    assert.match(child.stderr, /Agent Core sandbox entry was not found/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("the platform runtime closes the storefront before Agent Core and cleanup is idempotent", async () => {
  const events = [];
  const platform = await startPlatform({
    sandboxPort: 18787,
    demoPort: 14173,
    startSandbox: async (options) => {
      assert.deepEqual(options, { port: 18787, host: "127.0.0.1", quiet: true });
      return {
        server: {},
        baseUrl: "http://127.0.0.1:18787",
        token: "local_test_token",
        async close() { events.push("sandbox"); },
      };
    },
    startReferenceDemo: async (options) => {
      assert.equal(options.mode, "connected");
      assert.equal(options.agentCoreBaseUrl, "http://127.0.0.1:18787");
      assert.equal(options.agentCoreToken, "local_test_token");
      assert.equal(options.storefrontOrigin, "https://sandbox-store.example.invalid");
      assert.equal(options.verifyConnected, true);
      return {
        server: {},
        baseUrl: "http://127.0.0.1:14173",
        async close() { events.push("demo"); },
      };
    },
  });
  assert.equal(platform.url, "http://127.0.0.1:14173");
  await platform.close();
  await platform.close();
  assert.deepEqual(events, ["demo", "sandbox"]);
});

test("the platform closes Agent Core if the storefront fails to start", async () => {
  const events = [];
  await assert.rejects(
    startPlatform({
      startSandbox: async () => ({
        server: {},
        baseUrl: "http://127.0.0.1:18787",
        token: "local_test_token",
        async close() { events.push("sandbox"); },
      }),
      startReferenceDemo: async () => {
        throw new Error("demo port is unavailable");
      },
    }),
    /demo port is unavailable/,
  );
  assert.deepEqual(events, ["sandbox"]);
});

test("the platform rejects an incomplete Agent Core runtime descriptor and still closes it", async () => {
  const events = [];
  await assert.rejects(
    startPlatform({
      startSandbox: async () => ({
        baseUrl: "http://127.0.0.1:18787",
        token: "",
        async close() { events.push("sandbox"); },
      }),
    }),
    /invalid runtime descriptor/,
  );
  assert.deepEqual(events, ["sandbox"]);
});

test("the platform refuses a non-loopback bind before starting Agent Core", async () => {
  let starts = 0;
  await assert.rejects(
    startPlatform({
      host: "0.0.0.0",
      startSandbox: async () => {
        starts += 1;
        throw new Error("must not start");
      },
    }),
    /loopback host/,
  );
  assert.equal(starts, 0);
});

test("the paired launcher returns only after a synthetic sandbox is reachable and authenticated", async () => {
  const token = "paired_launcher_test_tenant_token";
  let authProbe = "";
  let agentServer;
  const platform = await startPlatform({
    sandboxPort: 0,
    demoPort: 0,
    startSandbox: async ({ host }) => {
      agentServer = createServer((request, response) => {
        const url = new URL(request.url || "/", "http://127.0.0.1");
        if (url.pathname === "/sandbox/status") {
          response.writeHead(200, {
            "content-type": "application/json",
            "x-send-from-china-sandbox-mode": "synthetic_local_sandbox",
            "x-send-from-china-sandbox-boundary": "synthetic-fixture; no-shipping-rates; no-commerce-writes",
          });
          response.end(JSON.stringify({
            mode: "synthetic_local_sandbox",
            data_source: "synthetic_fixture",
            purchasable: false,
            shipping_rates: false,
            commerce_writes: false,
            credential_exposed: false,
          }));
          return;
        }
        if (url.pathname === "/api/search") {
          authProbe = String(request.headers.authorization || "");
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ mode: "published_snapshot", items: [] }));
          return;
        }
        response.writeHead(404).end();
      });
      await new Promise((resolve) => agentServer.listen(0, host, resolve));
      const baseUrl = `http://127.0.0.1:${agentServer.address().port}`;
      return {
        server: agentServer,
        baseUrl,
        token,
        close: () => new Promise((resolve) => agentServer.close(resolve)),
      };
    },
  });
  try {
    const status = await (await fetch(`${platform.url}/api/status`)).json();
    assert.equal(status.readiness, "ready");
    assert.equal(status.verified, true);
    assert.equal(status.live_agent_core, true);
    assert.equal(authProbe, `Bearer ${token}`);
  } finally {
    await platform.close();
  }
});
