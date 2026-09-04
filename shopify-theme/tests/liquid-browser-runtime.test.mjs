import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertRuntimeVersion,
  createBrowserPage,
  loadPinnedPlaywright,
  pinnedBrowserDescriptor,
  probeBrowser,
} from "./liquid-browser-runtime.mjs";

function fakeBrowser({
  contextError,
  initScriptError,
  pageError,
  closeError,
  pageUrl = "about:blank",
} = {}) {
  const calls = [];
  const page = { url: () => pageUrl };
  const context = {
    setDefaultTimeout(timeout) {
      calls.push(["setDefaultTimeout", timeout]);
    },
    async addInitScript(script) {
      calls.push(["addInitScript", script]);
      if (initScriptError) throw initScriptError;
    },
    async newPage() {
      calls.push(["newPage"]);
      if (pageError) throw pageError;
      return page;
    },
    async close() {
      calls.push(["close"]);
      if (closeError) throw closeError;
    },
  };
  const browser = {
    async newContext(options) {
      calls.push(["newContext", options]);
      if (contextError) throw contextError;
      return context;
    },
  };
  return { browser, context, page, calls };
}

function callCount(fake, method) {
  return fake.calls.filter(([name]) => name === method).length;
}

async function rejectsWithOriginal(action, original) {
  await assert.rejects(action, (error) => {
    assert.equal(error, original, "the original browser failure must remain observable");
    return true;
  });
}

test("page startup configures the isolated context before creating the page", async () => {
  const fake = fakeBrowser();
  const stages = [];
  const viewport = { width: 390, height: 844 };
  const result = await createBrowserPage(fake.browser, viewport, {
    initScript: "globalThis.fixtureReady = true;",
    onStage: (stage) => stages.push(stage),
  });

  assert.equal(result.context, fake.context);
  assert.equal(result.page, fake.page);
  assert.deepEqual(fake.calls[0], ["newContext", {
    viewport,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  }]);
  const methods = fake.calls.map(([method]) => method);
  assert.ok(methods.indexOf("setDefaultTimeout") < methods.indexOf("newPage"));
  assert.deepEqual(fake.calls.find(([method]) => method === "setDefaultTimeout"), [
    "setDefaultTimeout", 12000,
  ]);
  assert.equal(callCount(fake, "addInitScript"), 1);
  assert.deepEqual(stages, ["new_context", "init_script", "new_page", "ready"]);
  assert.equal(callCount(fake, "close"), 0, "the caller owns a successfully created context");
});

test("a failed context creation is surfaced without attempting a page or retry", async () => {
  const original = new Error("browser.newContext: process exited");
  const fake = fakeBrowser({ contextError: original });

  await rejectsWithOriginal(() => createBrowserPage(fake.browser), original);

  assert.equal(callCount(fake, "newContext"), 1);
  assert.equal(callCount(fake, "newPage"), 0);
  assert.equal(callCount(fake, "close"), 0);
});

test("a failed init script closes the acquired context before surfacing the failure", async () => {
  const original = new Error("browserContext.addInitScript: context closed");
  const fake = fakeBrowser({ initScriptError: original });
  const stages = [];

  await rejectsWithOriginal(() => createBrowserPage(fake.browser, undefined, {
    initScript: "globalThis.fixtureReady = true;",
    onStage: (stage) => stages.push(stage),
  }), original);

  assert.equal(callCount(fake, "newContext"), 1);
  assert.equal(callCount(fake, "newPage"), 0);
  assert.equal(callCount(fake, "close"), 1);
  assert.deepEqual(stages, ["new_context", "init_script"]);
});

test("a failed page creation closes its context once and preserves the Firefox _page error", async () => {
  const original = new Error("browserContext.newPage: Internal error: _page is undefined");
  const fake = fakeBrowser({ pageError: original });
  const stages = [];

  await rejectsWithOriginal(() => createBrowserPage(fake.browser, undefined, {
    onStage: (stage) => stages.push(stage),
  }), original);

  assert.equal(callCount(fake, "newContext"), 1);
  assert.equal(callCount(fake, "newPage"), 1);
  assert.equal(callCount(fake, "close"), 1);
  assert.deepEqual(stages, ["new_context", "new_page"]);
});

test("cleanup failure cannot replace the original page startup failure", async () => {
  const original = new Error("browserContext.newPage: Internal error: _page is undefined");
  const fake = fakeBrowser({
    pageError: original,
    closeError: new Error("browserContext.close: browser already exited"),
  });

  await rejectsWithOriginal(() => createBrowserPage(fake.browser), original);

  assert.equal(callCount(fake, "newPage"), 1, "failed startup is not retried");
  assert.equal(callCount(fake, "close"), 1, "cleanup is attempted exactly once");
});

test("cleanup failure cannot replace the original init script failure", async () => {
  const original = new Error("browserContext.addInitScript: protocol error");
  const fake = fakeBrowser({
    initScriptError: original,
    closeError: new Error("browserContext.close: protocol disconnected"),
  });

  await rejectsWithOriginal(() => createBrowserPage(fake.browser, undefined, {
    initScript: "globalThis.fixtureReady = true;",
  }), original);

  assert.equal(callCount(fake, "newPage"), 0);
  assert.equal(callCount(fake, "close"), 1);
});

test("a successful runtime probe checks a blank page and closes its context", async () => {
  const fake = fakeBrowser();

  const result = await probeBrowser(fake.browser);

  assert.deepEqual(result, { page_url: "about:blank", context_closed: true });
  assert.equal(callCount(fake, "newContext"), 1);
  assert.equal(callCount(fake, "newPage"), 1);
  assert.equal(callCount(fake, "addInitScript"), 0, "the probe must isolate browser startup");
  assert.equal(callCount(fake, "close"), 1);
});

test("a failed runtime probe reports the startup error and closes its context", async () => {
  const original = new Error("browserContext.newPage: Internal error: _page is undefined");
  const fake = fakeBrowser({ pageError: original });

  await rejectsWithOriginal(() => probeBrowser(fake.browser), original);

  assert.equal(callCount(fake, "newPage"), 1);
  assert.equal(callCount(fake, "close"), 1);
});

test("a runtime probe rejects unexpected navigation while still closing its context", async () => {
  const fake = fakeBrowser({ pageUrl: "https://example.invalid/unexpected" });

  await assert.rejects(() => probeBrowser(fake.browser));

  assert.equal(callCount(fake, "close"), 1);
});

test("a runtime probe cannot report success when context cleanup fails", async () => {
  const original = new Error("browserContext.close: browser did not acknowledge closure");
  const fake = fakeBrowser({ closeError: original });

  await rejectsWithOriginal(() => probeBrowser(fake.browser), original);

  assert.equal(callCount(fake, "newPage"), 1);
  assert.equal(callCount(fake, "close"), 1);
});

test("the runtime version gate accepts the pinned version and rejects mismatches", () => {
  assert.doesNotThrow(() => assertRuntimeVersion({
    name: "playwright-core", actual: "1.59.1", expected: "1.59.1",
  }));
  assert.throws(() => assertRuntimeVersion({
    name: "playwright-core", actual: "1.58.0", expected: "1.59.1",
  }), (error) => {
    assert.match(error.message, /playwright-core/);
    assert.match(error.message, /1\.58\.0/);
    assert.match(error.message, /1\.59\.1/);
    return true;
  });
});

test("platform-specific browser descriptors retain their revision and unknown version", () => {
  const requested = [];
  const executable = "/pinned/webkit-2251/pw_run.sh";
  const registry = {
    findExecutable(name) {
      requested.push(name);
      return {
        revision: "2251",
        browserVersion: undefined,
        executablePath: () => executable,
      };
    },
  };

  assert.deepEqual(pinnedBrowserDescriptor(registry, "webkit"), {
    revision: "2251",
    browserVersion: null,
    executablePath: executable,
  });
  assert.deepEqual(requested, ["webkit"]);
});

test("Chromium provenance selects the headless shell descriptor used by the gate", () => {
  const requested = [];
  const registry = {
    findExecutable(name) {
      requested.push(name);
      assert.equal(name, "chromium-headless-shell");
      return {
        revision: "1217",
        browserVersion: "147.0.7727.15",
        executablePath: () => "/pinned/chromium_headless_shell-1217/headless_shell",
      };
    },
  };

  assert.deepEqual(pinnedBrowserDescriptor(registry, "chromium"), {
    revision: "1217",
    browserVersion: "147.0.7727.15",
    executablePath: "/pinned/chromium_headless_shell-1217/headless_shell",
  });
  assert.deepEqual(requested, ["chromium-headless-shell"]);
});

test("a mismatched root Playwright package fails before a matching fallback can be selected", async (t) => {
  const repoRoot = await realpath(fileURLToPath(new URL("../..", import.meta.url)));
  const workDir = path.join(repoRoot, "work");
  await mkdir(workDir, { recursive: true });
  const resolvedWorkDir = await realpath(workDir);
  assert.equal(path.dirname(resolvedWorkDir), repoRoot, "fixtures must stay inside the repository work directory");
  const fixtureRoot = await mkdtemp(path.join(resolvedWorkDir, "liquid-runtime-version-"));
  t.after(async () => {
    const resolvedFixture = await realpath(fixtureRoot);
    assert.equal(path.dirname(resolvedFixture), resolvedWorkDir, "only the test-created fixture may be removed");
    assert.match(path.basename(resolvedFixture), /^liquid-runtime-version-/);
    await rm(resolvedFixture, { recursive: true, force: true });
  });
  const rootPackageDir = path.join(fixtureRoot, "node_modules", "playwright-core");
  const fallbackPackageDir = path.join(fixtureRoot, "scripts", ".qa-deps", "node_modules", "playwright-core");
  await Promise.all([
    mkdir(rootPackageDir, { recursive: true }),
    mkdir(fallbackPackageDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
      name: "liquid-runtime-test-fixture",
      private: true,
      devDependencies: { "playwright-core": "1.59.1" },
    })),
    writeFile(path.join(rootPackageDir, "package.json"), JSON.stringify({
      name: "playwright-core", version: "1.58.0",
    })),
    writeFile(path.join(fallbackPackageDir, "package.json"), JSON.stringify({
      name: "playwright-core", version: "1.59.1",
    })),
  ]);

  // Neither fixture package has executable code. The version rejection must
  // precede import and must retain the root package's mismatched identity.
  await assert.rejects(() => loadPinnedPlaywright(fixtureRoot), (error) => {
    assert.match(error.message, /playwright-core runtime mismatch/);
    assert.match(error.message, /expected 1\.59\.1, received 1\.58\.0/);
    return true;
  });
});
