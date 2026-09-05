import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bootstrapFailureHint } from "./liquid-browser-runtime.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(path.join(repoRoot, "package-lock.json"), "utf8"));
const playwrightPin = packageJson.devDependencies["playwright-core"];
const development = await readFile(path.join(repoRoot, "docs", "DEVELOPMENT.md"), "utf8");

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

test("the repository exposes one exact locked Playwright engine installer", () => {
  assert.match(playwrightPin, /^\d+\.\d+\.\d+$/u, "playwright-core must use an exact version");
  assert.equal(packageLock.packages[""].devDependencies["playwright-core"], playwrightPin);
  assert.equal(packageLock.packages["node_modules/playwright-core"].version, playwrightPin);
  assert.equal(
    packageJson.scripts["browsers:install"],
    "playwright-core install chromium firefox webkit",
  );
});

test("the locked installer resolves every required engine without downloading in dry-run mode", async () => {
  const installedPackage = JSON.parse(await readFile(
    path.join(repoRoot, "node_modules", "playwright-core", "package.json"),
    "utf8",
  ));
  assert.equal(installedPackage.version, playwrightPin,
    "installed playwright-core must match the package and lock-file pin");
  const parent = await mkdtemp(path.join(os.tmpdir(), "store-browser-install-"));
  const browserCache = path.join(parent, "browser-cache");
  try {
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "node_modules", "playwright-core", "cli.js"),
      "install",
      "--dry-run",
      "chromium",
      "firefox",
      "webkit",
    ], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserCache },
      timeout: 30_000,
      windowsHide: true,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    assert.equal(result.error, undefined, output);
    assert.equal(result.signal, null, output);
    assert.equal(result.status, 0, output);
    assert.match(output, /Chrome for Testing[^\n]+\(playwright chromium v\d+\)/u);
    assert.match(output, /Firefox[^\n]+\(playwright firefox v\d+\)/u);
    assert.match(output, /WebKit[^\n]+\(playwright webkit v\d+\)/u);
    assert.ok(
      output.replaceAll("\\", "/").includes(path.resolve(browserCache).replaceAll("\\", "/")),
      "dry-run install locations must use the selected PLAYWRIGHT_BROWSERS_PATH",
    );
    assert.equal(await exists(browserCache), false, "dry-run must not create or download a browser cache");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("development setup documents the installer, shared cache, and local-only boundary", () => {
  const section = development.match(/## Actual Liquid\/App Proxy preview QA[\s\S]*?(?=\n## |$)/u)?.[0];
  assert.ok(section, "Actual Liquid/App Proxy preview QA section is missing");
  const compactSection = section.replace(/\s+/gu, " ");
  const install = section.indexOf("`npm run browsers:install`");
  const verify = section.indexOf("`npm run qa:liquid`");
  assert.ok(install >= 0 && verify > install, "browser installation must precede the QA command");
  const documentedVersions = [...development.matchAll(
    /(?:Playwright\s+|playwright-core@)(?<version>\d+\.\d+\.\d+)/gu,
  )].map(match => match.groups.version);
  assert.ok(documentedVersions.length > 0, "Playwright version must be documented");
  assert.ok(documentedVersions.every(version => version === playwrightPin),
    `documented Playwright versions must match package pin ${playwrightPin}`);
  for (const literal of [
    `locked \`playwright-core@${playwrightPin}\``,
    "same `PLAYWRIGHT_BROWSERS_PATH`",
    "does not replace the installed Chrome-family browser",
    "does not contact Shopify, Agent Core, a BFF, or a production host",
  ]) assert.ok(compactSection.includes(literal), `missing browser setup boundary: ${literal}`);

  const examples = [...section.matchAll(/```(?<shell>bash|powershell)\n(?<body>[\s\S]*?)```/gu)];
  for (const [shell, cacheLiteral] of [
    ["bash", 'export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/wp-reference-store-playwright"'],
    ["powershell", '$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA "wp-reference-store-playwright"'],
  ]) {
    const example = examples.find(item => item.groups.shell === shell)?.groups.body;
    assert.ok(example, `missing ${shell} browser cache example`);
    const cache = example.indexOf(cacheLiteral);
    const exampleInstall = example.indexOf("npm run browsers:install");
    const qa = example.indexOf("npm run qa:liquid");
    assert.ok(cache >= 0 && exampleInstall > cache && qa > exampleInstall,
      `${shell} example must retain one external cache for install and QA`);
  }
});

test("a missing pinned engine points to the repository installer without confusing system Chrome", () => {
  const missing = new Error("browserType.launch: Executable doesn't exist at /empty/browser-cache");
  for (const browser of ["chromium", "firefox", "webkit"]) {
    const hint = bootstrapFailureHint(browser, "launch", missing);
    assert.match(hint, /npm run browsers:install/u, browser);
    assert.match(hint, /PLAYWRIGHT_BROWSERS_PATH/u, browser);
  }
  assert.equal(bootstrapFailureHint("chrome", "launch", missing), null);
});
