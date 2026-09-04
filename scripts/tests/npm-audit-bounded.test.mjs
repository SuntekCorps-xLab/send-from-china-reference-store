import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_TIMEOUT_MS,
  DELAYS_MS,
  MAX_ATTEMPTS,
  isRegistryServerError,
  isRegistryTransientError,
  npmExecutable,
  runAudit,
} from "../npm-audit-bounded.mjs";

function writer() {
  let value = "";
  return { write(text) { value += text; }, get value() { return value; } };
}

test("classification retries only explicit npm Registry audit failures", () => {
  assert.equal(isRegistryServerError("npm warn audit 503 Service Unavailable"), true);
  assert.equal(isRegistryServerError("npm audit 502 Bad Gateway"), true);
  assert.equal(isRegistryServerError("found 1 high severity vulnerability"), false);
  assert.equal(isRegistryServerError("ECONNRESET before TLS"), false);
  assert.equal(
    isRegistryTransientError(
      "npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/quick",
    ),
    true,
  );
  assert.equal(
    isRegistryTransientError(
      "npm error code EAI_AGAIN\nnpm error request failed https://registry.npmjs.org/-/npm/v1/security/audits/bulk",
    ),
    true,
  );
  assert.equal(
    isRegistryTransientError([
      "{ statusCode: 400, error: 'Bad Request', message: 'Invalid package tree, run npm install' }",
      "npm notice This endpoint is being retired. Use the bulk advisory endpoint instead.",
      "npm warn audit 400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick - Bad Request",
    ].join("\n")),
    true,
  );
  assert.equal(
    isRegistryTransientError(
      "npm warn audit 400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick - Bad Request",
    ),
    false,
  );
  assert.equal(isRegistryTransientError("network timeout at: https://example.com/audit"), false);
  assert.equal(isRegistryTransientError("ECONNRESET before TLS"), false);
  assert.equal(isRegistryTransientError("found 1 high severity vulnerability"), false);
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

test("an npm Registry audit endpoint timeout is retried with bounded backoff", async () => {
  let calls = 0;
  const delays = [];
  const error = writer();
  const exitCode = await runAudit({
    spawn() {
      calls += 1;
      return calls === 1
        ? {
          status: 1,
          stdout: "",
          stderr: "npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/quick\n",
        }
        : { status: 0, stdout: "found 0 vulnerabilities\n", stderr: "" };
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    stdout: writer(),
    stderr: error,
  });
  assert.equal(exitCode, 0);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [5_000]);
  assert.match(error.value, /transient Registry failure; retrying attempt 2\/3/u);
});

test("a retired quick-endpoint fallback after a bulk failure is retried", async () => {
  let calls = 0;
  const delays = [];
  const exitCode = await runAudit({
    spawn() {
      calls += 1;
      return calls === 1
        ? {
          status: 1,
          stdout: [
            "{ statusCode: 400, error: 'Bad Request', message: 'Invalid package tree' }",
            "npm notice This endpoint is being retired. Use the bulk advisory endpoint instead.",
          ].join("\n"),
          stderr: "npm warn audit 400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick - Bad Request\n",
        }
        : { status: 0, stdout: "found 0 vulnerabilities\n", stderr: "" };
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    stdout: writer(),
    stderr: writer(),
  });
  assert.equal(exitCode, 0);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [5_000]);
});

test("an audit timeout is retried at most three times and then fails closed", async () => {
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
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5_000, 15_000]);
  assert.match(error.value, new RegExp(`timed out after ${AUDIT_TIMEOUT_MS}ms`, "u"));
  assert.match(error.value, /attempt 3\/3/u);
  assert.match(error.value, /vulnerability status is unknown and the gate remains failed/u);
});

test("an audit timeout followed by a clean result preserves success", async () => {
  let calls = 0;
  const delays = [];
  const exitCode = await runAudit({
    spawn() {
      calls += 1;
      return calls === 1
        ? {
          status: null,
          stdout: "",
          stderr: "",
          error: Object.assign(new Error("spawnSync npm ETIMEDOUT"), { code: "ETIMEDOUT" }),
        }
        : { status: 0, stdout: "found 0 vulnerabilities\n", stderr: "" };
    },
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    stdout: writer(),
    stderr: writer(),
  });
  assert.equal(exitCode, 0);
  assert.equal(calls, 2);
  assert.deepEqual(delays, [5_000]);
});
