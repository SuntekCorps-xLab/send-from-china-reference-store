import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_ATTEMPTS = 3;
export const DELAYS_MS = Object.freeze([5_000, 15_000]);
export const AUDIT_TIMEOUT_MS = 420_000;

export function isRegistryServerError(output) {
  const text = String(output || "");
  return /npm\s+(?:warn\s+)?audit\s+5\d\d\b/iu.test(text)
    || /\b5\d\d\s+(?:Service Unavailable|Bad Gateway|Gateway Timeout|Internal Server Error)\b/iu.test(text);
}

export function isRegistryTransientError(output) {
  const text = String(output || "");
  if (isRegistryServerError(text)) return true;

  // Retry only transport failures that npm explicitly attributes to the public
  // audit endpoint. A generic timeout or connection error could come from a
  // lifecycle script or another service and must remain fail closed.
  const auditEndpoint = String.raw`https:\/\/registry\.npmjs\.org\/-\/npm\/v1\/security\/audits\/(?:quick|bulk)`;
  return new RegExp(
    String.raw`npm\s+(?:warn\s+)?audit\s+(?:network\s+timeout\s+at:|request\s+to)\s+${auditEndpoint}`,
    "iu",
  ).test(text)
    || new RegExp(
      String.raw`npm\s+error\s+code\s+(?:EAI_AGAIN|ECONNRESET|ETIMEDOUT)[\s\S]{0,1000}${auditEndpoint}`,
      "iu",
    ).test(text)
    || (
      /\bstatusCode:\s*400\b[\s\S]*\bInvalid package tree\b/iu.test(text)
      && /This endpoint is being retired\./iu.test(text)
      && new RegExp(`${auditEndpoint}[\\s\\S]*Bad Request`, "iu").test(text)
    );
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
      timeout: AUDIT_TIMEOUT_MS,
      windowsHide: true,
    });
    const out = String(result.stdout || "");
    const err = String(result.stderr || "");
    if (out) stdout.write(out);
    if (err) stderr.write(err);
    if (result.status === 0) return 0;

    if (result.error?.code === "ETIMEDOUT") {
      stderr.write(
        `npm audit timed out after ${AUDIT_TIMEOUT_MS}ms; vulnerability status is unknown and the gate remains failed.\n`,
      );
      return 1;
    }

    const transientRegistryFailure = isRegistryTransientError(`${out}\n${err}`);
    if (!transientRegistryFailure || attempt === MAX_ATTEMPTS) {
      return Number.isInteger(result.status) ? result.status : 1;
    }
    const delay = DELAYS_MS[attempt - 1];
    stderr.write(
      `npm audit transient Registry failure; retrying attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delay}ms.\n`,
    );
    await sleep(delay);
  }
  return 1;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await runAudit();
