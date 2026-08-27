import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadStartSandbox,
  resolveAgentCoreDirectory,
  startPlatform,
} from "./demo-platform.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agentCoreDirectory = await resolveAgentCoreDirectory();
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
    throw new Error(`paired integration smoke failed (${status.signal || status.code})`);
  }
  console.log(`PASS: paired Agent Core + Reference Store integration (${agentCoreDirectory})`);
} finally {
  await runtime.close();
}
