import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_TIMEOUT_MS,
  DELAYS_MS,
  MAX_ATTEMPTS,
  isRegistryServerError,
  npmExecutable,
  runAudit,
} from "../npm-audit-bounded.mjs";

function writer() {
  let value = "";
  return { write(text) { value += text; }, get value() { return value; } };
}

test("classification retries Registry 5xx but never vulnerability output or transport errors", () => {
  assert.equal(isRegistryServerError("npm warn audit 503 Service Unavailable"), true);
  assert.equal(isRegistryServerError("npm audit 502 Bad Gateway"), true);
  assert.equal(isRegistryServerError("found 1 high severity vulnerability"), false);
  assert.equal(isRegistryServerError("ECONNRESET before TLS"), false);
  assert.equal(MAX_ATTEMPTS, 3);
  assert.deepEqual(DELAYS_MS, [5_000, 15_000]);
  assert.equal(npmExecutable("win32"), "npm.cmd");
  assert.equal(npmExecutable("linux"), "npm");
});

test("a Registry 503 is retried at most three times with bounded backoff", async () => {
  let calls = 0;
  const delays = [];
  const output = writer();
  const error = writer();
  const exitCode = await runAudit({
    spawn(command, args, options) {
      calls += 1;
      assert.match(command, /^npm(?:\.cmd)?$/u);
      assert.deepEqual(args, ["audit", "--audit-level=high"]);
      assert.equal(options.env.npm_config_fetch_retries, "0");
      assert.equal(options.timeout, AUDIT_TIMEOUT_MS);
      return { status: 1, stdout: "", stderr: "npm warn audit 503 Service Unavailable\n" };
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    stdout: output,
    stderr: error,
  });
  assert.equal(exitCode, 1);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5_000, 15_000]);
  assert.match(error.value, /attempt 3\/3/u);
});

test("a real vulnerability failure is returned immediately without retry", async () => {
  let calls = 0;
  const delays = [];
  const exitCode = await runAudit({
    spawn() {
      calls += 1;
      return { status: 1, stdout: "1 high severity vulnerability\n", stderr: "" };
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    stdout: writer(),
    stderr: writer(),
  });
  assert.equal(exitCode, 1);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("audit success after a transient Registry failure preserves the zero exit", async () => {
  let calls = 0;
  const exitCode = await runAudit({
    spawn() {
      calls += 1;
      return calls === 1
        ? { status: 1, stdout: "", stderr: "npm audit 500 Internal Server Error" }
        : { status: 0, stdout: "found 0 vulnerabilities\n", stderr: "" };
    },
    sleep: async () => {},
    stdout: writer(),
    stderr: writer(),
  });
  assert.equal(exitCode, 0);
  assert.equal(calls, 2);
});

test("an audit timeout fails closed with a diagnostic and is never retried", async () => {
  let calls = 0;
  const delays = [];
  const error = writer();
  const exitCode = await runAudit({
    spawn() {
      calls += 1;
      return {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("spawnSync npm ETIMEDOUT"), { code: "ETIMEDOUT" }),
      };
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    stdout: writer(),
    stderr: error,
  });
  assert.equal(exitCode, 1);
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.match(error.value, new RegExp(`timed out after ${AUDIT_TIMEOUT_MS}ms`, "u"));
  assert.match(error.value, /vulnerability status is unknown and the gate remains failed/u);
});
