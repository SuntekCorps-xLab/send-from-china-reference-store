import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_ATTEMPTS = 3;
export const DELAYS_MS = Object.freeze([5_000, 15_000]);

export function isRegistryServerError(output) {
  const text = String(output || "");
  return /npm\s+(?:warn\s+)?audit\s+5\d\d\b/iu.test(text)
    || /\b5\d\d\s+(?:Service Unavailable|Bad Gateway|Gateway Timeout|Internal Server Error)\b/iu.test(text);
}

export function npmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runAudit({
  cwd = process.cwd(),
  spawn = spawnSync,
  sleep = pause,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = spawn(npmExecutable(), ["audit", "--audit-level=high"], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_fetch_retries: "0",
        npm_config_fetch_timeout: "120000",
      },
      timeout: 180_000,
      windowsHide: true,
    });
    const out = String(result.stdout || "");
    const err = String(result.stderr || "");
    if (out) stdout.write(out);
    if (err) stderr.write(err);
    if (result.status === 0) return 0;

    const registry5xx = isRegistryServerError(`${out}\n${err}`);
    if (!registry5xx || attempt === MAX_ATTEMPTS) return Number.isInteger(result.status) ? result.status : 1;
    const delay = DELAYS_MS[attempt - 1];
    stderr.write(`npm audit Registry 5xx; retrying attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delay}ms.\n`);
    await sleep(delay);
  }
  return 1;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await runAudit();
