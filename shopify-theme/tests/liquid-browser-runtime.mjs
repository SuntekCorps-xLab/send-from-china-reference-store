import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function assertRuntimeVersion({ name, actual, expected }) {
  assert.equal(actual, expected, name + " runtime mismatch: expected " + expected + ", received " + actual);
}

export async function loadPinnedPlaywright(repoRoot) {
  const require = createRequire(path.join(repoRoot, "package.json"));
  const manifest = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  let packagePath;
  let source = "node_resolution";
  try { packagePath = require.resolve("playwright-core/package.json"); }
  catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    source = "qa_fallback";
    packagePath = path.join(repoRoot, "scripts", ".qa-deps", "node_modules", "playwright-core", "package.json");
  }
  const installed = JSON.parse(await readFile(packagePath, "utf8"));
  assertRuntimeVersion({ name: "playwright-core", actual: installed.version, expected: manifest.devDependencies["playwright-core"] });
  const packageDir = path.dirname(packagePath);
  const playwright = await import(pathToFileURL(path.join(packageDir, "index.mjs")).href);
  // This internal descriptor is safe to use only after the exact package check.
  // It applies Playwright's own OS revision overrides and headless-shell choice.
  const { registry } = await import(pathToFileURL(path.join(packageDir, "lib", "server", "registry", "index.js")).href);
  const descriptors = Object.fromEntries(["chromium", "firefox", "webkit"].map(name => [name, pinnedBrowserDescriptor(registry, name)]));
  const relative = path.relative(repoRoot, packageDir);
  return {
    playwright, descriptors,
    identity: {
      node: process.version, platform: process.platform, architecture: process.arch,
      playwright: installed.version, dependency_source: source,
      module: relative.startsWith("..") || path.isAbsolute(relative) ? "external/playwright-core" : relative.replaceAll("\\", "/"),
      module_path_sha256: createHash("sha256").update(await realpath(packageDir)).digest("hex"),
    },
  };
}

export function pinnedBrowserDescriptor(registry, name) {
  const descriptor = registry.findExecutable(name === "chromium" ? "chromium-headless-shell" : name);
  assert.ok(descriptor, "Missing pinned browser descriptor: " + name);
  return { revision: descriptor.revision, browserVersion: descriptor.browserVersion || null, executablePath: descriptor.executablePath() };
}

export async function browserIdentity(browser, name, executablePath, runtime) {
  const expected = runtime.descriptors[name];
  const actual = browser.version();
  if (expected?.browserVersion) assertRuntimeVersion({ name, actual, expected: expected.browserVersion });
  const executable = await realpath(executablePath);
  // For OS-specific builds without a declared version, require the exact cache
  // executable selected by the pinned registry, including its revision override.
  if (expected && !expected.browserVersion) assert.equal(executable, await realpath(expected.executablePath), "Use the pinned platform-specific browser executable");
  return {
    name, version: actual,
    expected_version: expected?.browserVersion || null,
    playwright_revision: expected?.revision || null,
    executable_file: path.basename(executable),
    executable_path_sha256: createHash("sha256").update(executable).digest("hex"),
    executable_sha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
    executable_selection: name === "chrome" ? "installed_chrome" : process.env[name.toUpperCase() + "_PATH"] ? "explicit_path" : "playwright_cache",
  };
}

// Initialization belongs to the resource owner: callers cannot close a context
// they never received. Preserve the first failure if cleanup also fails.
export async function createBrowserPage(browser, viewport, { initScript, onStage = () => {} } = {}) {
  let context;
  try {
    onStage("new_context");
    context = await browser.newContext({
      ...(viewport ? { viewport: { width: viewport.width, height: viewport.height } } : {}),
      reducedMotion: "reduce", serviceWorkers: "block",
    });
    context.setDefaultTimeout(12000);
    if (initScript) {
      onStage("init_script");
      await context.addInitScript({ content: initScript });
    }
    onStage("new_page");
    const page = await context.newPage();
    onStage("ready");
    return { context, page };
  } catch (error) {
    if (context) {
      try { await context.close(); } catch { /* Keep the initialization failure. */ }
    }
    throw error;
  }
}

// No application, fixture, axe or network request is involved in this probe.
// Failure remains fatal; never retry with a different engine or weaker sandbox.
export async function probeBrowser(browser, onStage) {
  const { context, page } = await createBrowserPage(browser, undefined, { onStage });
  let failure;
  try { assert.equal(page.url(), "about:blank"); }
  catch (error) { failure = error; throw error; }
  finally {
    try { await context.close(); }
    catch (error) { if (!failure) throw error; }
  }
  return { page_url: "about:blank", context_closed: true };
}

export function bootstrapFailureHint(name, stage, error) {
  const message = String(error?.message || error);
  if (["chromium", "firefox", "webkit"].includes(name) && stage === "launch" && message.includes("Executable doesn't exist")) {
    return "The pinned Playwright browser engine is missing. From the repository root, run `npm run browsers:install` with the same `PLAYWRIGHT_BROWSERS_PATH` used for verification, then rerun the gate. If FIREFOX_PATH or WEBKIT_PATH is set, clear it or point it to the matching pinned executable.";
  }
  if (name !== "firefox" || stage !== "new_page" || !message.includes("_page")) return null;
  return "Firefox failed before an application page loaded. Inspect DEBUG=pw:browser for tab subprocess launch failures and verify the pinned executable. On Windows, an outer restricted executor can prevent the content process from starting; use an authorized compatible executor. Keep Firefox sandbox protections enabled. This is a failed gate, with no automatic retry or browser substitution.";
}
