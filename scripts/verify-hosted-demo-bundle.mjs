import { spawnSync } from "node:child_process";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "storefront-bff", "node_modules", "wrangler", "bin", "wrangler.js");
const output = path.join(root, "build", "hosted-demo-bundle");
const wranglerConfigHome = path.join(root, "build", "wrangler-config");

try {
  await access(wrangler);
} catch {
  process.stderr.write("FAIL: install the locked storefront-bff dependencies before bundling (npm ci --prefix storefront-bff).\n");
  process.exitCode = 1;
  process.exit();
}

await rm(output, { recursive: true, force: true });
const result = spawnSync(process.execPath, [
  wrangler,
  "deploy",
  "--dry-run",
  "--config",
  path.join(root, "hosted-demo", "wrangler.toml"),
  "--outdir",
  output,
], {
  cwd: root,
  encoding: "utf8",
  env: {
    ...process.env,
    WRANGLER_SEND_METRICS: "false",
    XDG_CONFIG_HOME: wranglerConfigHome,
  },
  windowsHide: true,
});
if (result.status !== 0) {
  process.stderr.write(result.stderr || "FAIL: hosted demo bundle failed without deployment.\n");
  process.exitCode = 1;
} else {
  process.stdout.write(result.stdout);
  process.stdout.write("PASS: hosted synthetic demo bundled with deployment disabled.\n");
}
