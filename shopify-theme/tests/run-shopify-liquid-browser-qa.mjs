import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROXY_PREFIX, SERVER_ONLY_SENTINELS, startLiquidPreview } from "./liquid-preview-fixture.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const artifactDir = path.join(repoRoot, "work", "shopify-liquid-qa");
const require = createRequire(import.meta.url);
const localModules = path.join(repoRoot, "scripts", ".qa-deps", "node_modules");
let playwright;
let axeSource;
try { playwright = await import("playwright-core"); }
catch { playwright = await import(pathToFileURL(path.join(localModules, "playwright-core", "index.mjs")).href); }
try { axeSource = await readFile(require.resolve("axe-core/axe.min.js"), "utf8"); }
catch { axeSource = await readFile(path.join(localModules, "axe-core", "axe.min.js"), "utf8"); }
const engines = { chromium: playwright.chromium, chrome: playwright.chromium, firefox: playwright.firefox, webkit: playwright.webkit };
const option = process.argv.find(value => value.startsWith("--browser="))?.split("=")[1];
const requested = process.argv.includes("--all") ? ["chrome", "firefox", "webkit"] : [option || "chrome"];
assert.ok(requested.every(name => engines[name]), "Use --all or --browser=chrome|chromium|firefox|webkit");
await mkdir(artifactDir, { recursive: true });
// Keep Playwright's isolated profiles and artifacts inside the authorized worktree.
const temporaryDir = path.join(artifactDir, "tmp");
await mkdir(temporaryDir, { recursive: true });
for (const variable of ["TMPDIR", "TMP", "TEMP"]) process.env[variable] = temporaryDir;
const preview = await startLiquidPreview();
const report = {
  ok: false, evidence_kind: "real_repository_liquid_local_mock_injected_e2e",
  live_shopify_verified: false,
  rendering: ["layout/chat.liquid", "sections/lm-home-chat.liquid", "sections/lm-search-chat.liquid", "sections/lm-collection.liquid", "sections/wp-workspace.liquid", "snippets/wp-agent-drawer.liquid"],
  transport: "same-origin App Proxy simulator -> real storefront BFF -> injected local Core",
  live_only_blockers: ["Staging App Proxy deployment and dedicated authenticated development-store identity were not supplied to this local test."],
  cases: [],
};
try {
  for (const name of requested) {
    const browser = await launch(name);
    try {
      for (const viewport of [
        { name: "desktop", width: 1440, height: 1000 },
        { name: "mobile", width: 390, height: 844 },
      ]) {
        const result = await runCase(browser, name, viewport);
        if (["chrome", "chromium"].includes(name) && viewport.name === "desktop") result.additional_journeys = await advancedCases(browser, viewport);
        report.cases.push(result);
        process.stdout.write(`PASS ${name}/${viewport.name}: real Liquid + same-origin status/doctor/runs + unavailable + isolation\n`);
      }
    } finally { await browser.close(); }
  }
  report.ok = true;
} catch (error) {
  report.failure = String(error.message || error);
  report.fixture_failures = preview.failures;
  report.last_proxy_responses = preview.ingress.map(({ pathname, status, response }) => ({ pathname, status, response }));
  throw error;
} finally {
  await writeFile(path.join(artifactDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await preview.close();
  process.stdout.write(JSON.stringify({ ok: report.ok, evidence_kind: report.evidence_kind,
    live_shopify_verified: false, browser_viewport_cases: report.cases.length,
    journeys: report.cases.reduce((total, item) => total + item.journeys.length + (item.additional_journeys?.length || 0), 0),
    report: path.relative(repoRoot, path.join(artifactDir, "report.json")).replaceAll("\\", "/"),
    ...(report.failure ? { failure: report.failure } : {}) }, null, 2) + "\n");
}

async function launch(name) {
  let executablePath;
  if (name === "chrome") {
    const paths = [process.env.CHROME_PATH,
      ...(process.platform === "win32" ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
        : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"])];
    for (const candidate of paths.filter(Boolean)) {
      try { await access(candidate); executablePath = candidate; break; } catch {}
    }
    assert.ok(executablePath, "Chrome unavailable: set CHROME_PATH; this matrix does not relabel Chromium as Chrome");
  } else if (name !== "chromium") executablePath = process.env[name === "firefox" ? "FIREFOX_PATH" : "WEBKIT_PATH"];
  try {
    return await engines[name].launch({
      headless: true, timeout: 20000, ...(executablePath ? { executablePath } : {}),
      ...(name === "chrome" ? { args: ["--disable-background-networking", "--disable-component-update", "--disable-extensions", "--disable-sync", "--no-first-run"] } : {}),
    });
  } catch (error) { throw new Error(`${name} browser unavailable: ${error.message.split("\n")[0]}`); }
}

async function newPage(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "reduce", serviceWorkers: "block",
  });
  await context.addInitScript({ content: axeSource });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const log = { requests: [], consoleErrors: [], pageErrors: [], responses: [] };
  page.on("console", message => { if (message.type() === "error") log.consoleErrors.push(message.text()); });
  page.on("pageerror", error => log.pageErrors.push(error.message));
  page.on("request", request => log.requests.push({ url: request.url(), method: request.method(), body: request.postData(), headers: request.headers(), resourceType: request.resourceType() }));
  page.on("response", response => {
    if (new URL(response.url()).pathname.startsWith(PROXY_PREFIX)) {
      log.responses.push(response.text().then(body => ({ status: response.status(), body })));
    }
  });
  return { page, context, log };
}

async function load(page, pathname = "/") {
  const response = await page.goto(`${preview.origin}${pathname}`, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200, JSON.stringify(preview.failures));
  await page.waitForFunction(() => Boolean(window.WPShopifyRuntime));
  return page.evaluate(() => window.WPShopifyRuntime.status());
}

async function audit(page, context, log, label, { negative = false } = {}) {
  const state = await page.evaluate(async () => {
    const result = await window.axe.run(document, { resultTypes: ["violations"] });
    const databases = indexedDB.databases ? await indexedDB.databases() : [];
    const moving = [...document.querySelectorAll(".wp-agent-drawer, .wp-agent-layer *, .sfc-product, .sfc-search-card")]
      .filter(element => element.getClientRects().length)
      .filter(element => Number.parseFloat(getComputedStyle(element).animationDuration) > .001)
      .map(element => element.className);
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      moving,
      storage: { local: localStorage.length, session: sessionStorage.length, indexedDb: databases.length, cookie: document.cookie },
      seriousAxe: result.violations.filter(item => ["serious", "critical"].includes(item.impact))
        .map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })),
      composer: (() => {
        const input = document.querySelector("[data-agent-input]");
        const send = document.querySelector("[data-agent-send]");
        if (!input?.getClientRects().length) return null;
        const inputBox = input.getBoundingClientRect();
        const sendBox = send.getBoundingClientRect();
        return { width: inputBox.width, bottomDifference: Math.abs(inputBox.bottom - sendBox.bottom) };
      })(),
      html: document.documentElement.outerHTML,
    };
  });
  if (state.composer) {
    assert.ok(state.composer.width >= 240, label + ": composer input too narrow: " + state.composer.width);
    assert.ok(state.composer.bottomDifference <= 3, label + ": send control must share the composer input row");
  }
  assert.ok(state.overflow <= 1, `${label}: horizontal overflow ${state.overflow}px`);
  assert.equal(state.reducedMotion, true, `${label}: reduced-motion preference lost`);
  assert.deepEqual(state.moving, [], `${label}: animation ignores reduced motion`);
  assert.deepEqual(state.seriousAxe, [], `${label}: serious/critical accessibility violations`);
  assert.deepEqual(state.storage, { local: 0, session: 0, indexedDb: 0, cookie: "" }, `${label}: query/credential persisted in isolated context`);
  assert.deepEqual(await context.cookies(), [], `${label}: cookie persisted in isolated context`);
  assert.deepEqual(log.pageErrors, [], `${label}: page errors`);
  const unexpectedConsole = negative
    ? log.consoleErrors.filter(value => !/Failed to load resource: the server responded with a status of (502|503)/u.test(value))
    : log.consoleErrors;
  assert.deepEqual(unexpectedConsole, [], `${label}: unexpected console errors`);
  assert.deepEqual(preview.failures, [], `${label}: fixture failed`);
  assert.ok(log.requests.every(request => new URL(request.url).origin === preview.origin), `${label}: unapproved external browser request`);
  assert.ok(log.requests.every(request => !/\/api\/(chat|search|catalog)(?:\/|$|\?)/u.test(new URL(request.url).pathname)), `${label}: legacy route called`);
  assert.ok(log.requests.every(request => !/(?:^|\/)tasks(?:\/|$)|\/cart(?:\/|$)|\/checkout(?:\/|$)/u.test(new URL(request.url).pathname)), `${label}: write/commerce route called`);
  const apiRoutes = new Map([
    [PROXY_PREFIX + "/api/runtime/status", "GET"],
    [PROXY_PREFIX + "/api/runtime/doctor", "GET"],
    [PROXY_PREFIX + "/api/runs", "POST"],
  ]);
  for (const request of log.requests.filter(item => ["fetch", "xhr"].includes(item.resourceType))) {
    const pathname = new URL(request.url).pathname;
    assert.equal(request.method, apiRoutes.get(pathname), label + ": API request outside the read-only contract");
    if (request.method === "POST") {
      const body = JSON.parse(request.body);
      assert.deepEqual(Object.keys(body).sort(), ["limit", "query"]);
      assert.equal(body.limit, 20);
      assert.ok(typeof body.query === "string" && body.query.length <= 300);
    }
  }
  const responses = await Promise.all(log.responses);
  const browserEnvelope = `${state.html}\n${JSON.stringify(log.requests)}\n${JSON.stringify(responses)}`;
  for (const sentinel of SERVER_ONLY_SENTINELS) assert.ok(!browserEnvelope.includes(sentinel), `${label}: server-only credential leaked`);
  for (const request of log.requests.filter(request => request.url.includes(`${PROXY_PREFIX}/api/`))) {
    assert.ok(!request.headers.authorization && !request.headers["x-api-key"], `${label}: browser supplied credential`);
    assert.equal(new URL(request.url).search, "", `${label}: browser received proxy signature or credential query`);
  }
  return { overflow: state.overflow, console_errors: unexpectedConsole.length, expected_injected_http_fault_console_messages: log.consoleErrors.length - unexpectedConsole.length, page_errors: 0, axe_serious_critical: 0,
    reduced_motion: true, storage_empty: true, credentials_isolated: true, external_requests: 0, legacy_requests: 0 };
}

async function runCase(browser, name, viewport) {
  const label = `${name}/${viewport.name}`;
  const result = { browser: name, browser_version: browser.version(), viewport: `${viewport.width}x${viewport.height}`, journeys: [] };
  preview.setScenario("ready");
  let session = await newPage(browser, viewport);
  try {
    const runtime = await load(session.page);
    assert.equal(runtime.connected, true);
    assert.equal(runtime.mode, "shopify_read_only");
    const opener = session.page.locator("[data-open-agent-drawer]").first();
    await opener.click();
    await session.page.locator(".wp-agent-drawer").waitFor({ state: "visible" });
    await session.page.locator(".wp-agent-drawer").evaluate(drawer => {
      [...drawer.querySelectorAll("button:not([disabled]),textarea:not([disabled]),a[href]")]
        .filter(node => node.getClientRects().length)[0].focus();
    });
    await session.page.keyboard.press("Shift+Tab");
    assert.equal(await session.page.locator(".wp-agent-drawer").evaluate(drawer => {
      const nodes = [...drawer.querySelectorAll("button:not([disabled]),textarea:not([disabled]),a[href]")].filter(node => node.getClientRects().length);
      return document.activeElement === nodes.at(-1);
    }), true, label + ": Shift+Tab must wrap inside dialog");
    await session.page.keyboard.press("Tab");
    assert.equal(await session.page.locator(".wp-agent-drawer").evaluate(drawer => {
      const nodes = [...drawer.querySelectorAll("button:not([disabled]),textarea:not([disabled]),a[href]")].filter(node => node.getClientRects().length);
      return document.activeElement === nodes[0];
    }), true, label + ": Tab must wrap inside dialog");
    await session.page.locator("[data-agent-input]").fill("desk organizer");
    await session.page.locator("[data-agent-send]").click();
    await session.page.locator(".wp-agent-product").first().waitFor();
    const card = session.page.locator(".wp-agent-product").first();
    assert.match(await card.innerText(), /Verified desk organizer/u);
    assert.match(await card.innerText(), /19\.95/u);
    assert.equal(await card.locator('a[href="/products/verified-desk-organizer"]').count(), 1);
    const drawerWidth = await session.page.locator(".wp-agent-drawer").evaluate(element => element.getBoundingClientRect().width);
    if (viewport.name === "mobile") assert.ok(Math.abs(drawerWidth - viewport.width) <= 1, `${label}: mobile drawer width ${drawerWidth}`);
    result.journeys.push({ name: "home_drawer_read", ...await audit(session.page, session.context, session.log, label) });
    await session.page.screenshot({ path: path.join(artifactDir, `${name}-${viewport.name}-drawer.png`), fullPage: false });
    await session.page.keyboard.press("Escape");
    await session.page.locator(".wp-agent-drawer").waitFor({ state: "hidden" });
    assert.equal(await opener.evaluate(element => element === document.activeElement), true, `${label}: focus not restored after Escape`);
    await opener.click();
    await session.page.locator("[data-runtime-doctor]").first().click();
    await session.page.waitForFunction(() => Boolean(document.querySelector("[data-runtime-doctor-result]")?.textContent.trim()));
    assert.ok(preview.ingress.some(item => item.pathname === `${PROXY_PREFIX}/api/runtime/doctor` && item.status === 200), `${label}: doctor did not use proxy`);
    assert.ok(preview.ingress.some(item => item.pathname === `${PROXY_PREFIX}/api/runs` && item.status === 200), `${label}: run did not use proxy`);
    result.journeys.push({ name: "server_doctor", ...await audit(session.page, session.context, session.log, label) });
    await load(session.page, "/search?q=desk%20organizer");
    await session.page.locator(".sfc-search-card").first().waitFor();
    assert.match(await session.page.locator("[data-search-results]").innerText(), /Verified desk organizer/u);
    result.journeys.push({ name: "search_read", ...await audit(session.page, session.context, session.log, label) });
    await session.page.screenshot({ path: path.join(artifactDir, `${name}-${viewport.name}-search.png`), fullPage: true });
    result.successful_runs = preview.ingress.filter(item => item.pathname.endsWith("/api/runs") && item.status === 200).length;
    assert.ok(result.successful_runs >= 2);
    assert.ok(preview.upstream.every(item => item.authenticated && ["/sandbox/status", "/sandbox/api/search/v2"].includes(item.pathname)));
  } finally { await session.context.close(); }

  for (const state of ["credential_missing", "permission_required"]) {
    preview.setScenario(state);
    session = await newPage(browser, viewport);
    try {
      const runtime = await load(session.page);
      assert.equal(runtime.connected, false);
      assert.equal(runtime.credential_state, state);
      await session.page.waitForFunction(() => [...document.querySelectorAll("[data-open-agent-drawer]")].every(button => button.dataset.runtimeReady === "false"));
      await session.page.locator("[data-open-agent-drawer]").first().click();
      assert.equal(await session.page.locator("[data-agent-input]").isDisabled(), true);
      assert.equal(await session.page.locator("[data-agent-send]").isDisabled(), true);
      assert.equal(await session.page.locator("[data-runtime-sourcing]").isDisabled(), true);
      assert.match(await session.page.locator("[data-runtime-status]").first().innerText(), /unavailable|credential|permission/iu);
      assert.ok(!preview.ingress.some(item => item.method === "POST"), `${label}/${state}: unavailable homepage initiated a run`);
      await load(session.page, "/search?q=desk%20organizer");
      assert.equal(await session.page.locator(".sfc-search-card").count(), 0);
      assert.ok(!preview.ingress.some(item => item.method === "POST"), `${label}/${state}: unavailable search initiated a run`);
      result.journeys.push({ name: state, ...await audit(session.page, session.context, session.log, `${label}/${state}`) });
      if (state === "credential_missing") await session.page.screenshot({ path: path.join(artifactDir, `${name}-${viewport.name}-unavailable.png`), fullPage: true });
    } finally { await session.context.close(); }
  }

  preview.setScenario("upstream_failure");
  session = await newPage(browser, viewport);
  try {
    await load(session.page);
    await session.page.locator("[data-open-agent-drawer]").first().click();
    await session.page.locator("[data-agent-input]").fill("desk organizer");
    await session.page.locator("[data-agent-send]").click();
    await session.page.waitForFunction(() => Boolean(document.querySelector("[data-agent-status]")?.textContent.match(/unavailable|failed|error/iu)));
    assert.equal(await session.page.locator(".wp-agent-product").count(), 0);
    assert.ok(preview.ingress.some(item => item.pathname.endsWith("/api/runs") && item.status >= 500));
    result.journeys.push({ name: "upstream_failure_no_fallback", ...await audit(session.page, session.context, session.log, `${label}/upstream_failure`, { negative: true }) });
  } finally { await session.context.close(); }
  return result;
}



async function advancedCases(browser, viewport) {
  const results = [];
  for (const scenario of ["synthetic_mismatch", "cross_origin_config"]) {
    preview.setScenario(scenario);
    const session = await newPage(browser, viewport);
    try {
      const response = await session.page.goto(preview.origin, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      await session.page.locator("[data-open-agent-drawer]").first().click();
      await session.page.waitForFunction(() => document.querySelector("[data-agent-input]")?.disabled);
      const label = await session.page.locator("[data-runtime-status]").first().innerText();
      assert.match(label, /unavailable/iu);
      assert.doesNotMatch(label, /Live Shopify/iu);
      assert.equal(await session.page.locator(".wp-agent-product").count(), 0);
      assert.ok(!preview.ingress.some(item => item.method === "POST"));
      if (scenario === "cross_origin_config") assert.equal(preview.ingress.length, 0, "invalid external proxy must produce no API request");
      else assert.ok(preview.ingress.some(item => item.status === 502 && JSON.parse(item.response).error === "runtime_mode_mismatch"));
      results.push({ name: scenario, ...await audit(session.page, session.context, session.log, scenario, { negative: true }) });
    } finally { await session.context.close(); }
  }
  preview.setScenario("degraded");
  let session = await newPage(browser, viewport);
  try {
    await load(session.page, "/search?q=desk%20organizer");
    await session.page.waitForFunction(() => /incomplete/i.test(document.querySelector("[data-search-results]")?.textContent || ""));
    const text = await session.page.locator("[data-search-results]").innerText();
    assert.match(text, /incomplete/iu);
    assert.doesNotMatch(text, /no matches|no products|nothing found/iu);
    results.push({ name: "degraded_is_not_no_match", ...await audit(session.page, session.context, session.log, "degraded") });
  } finally { await session.context.close(); }
  preview.setScenario("signed_in");
  session = await newPage(browser, viewport);
  try {
    await load(session.page, "/pages/workspace");
    assert.match(await session.page.locator("h1").innerText(), /Custom sourcing unavailable/iu);
    assert.equal(await session.page.locator(".wp-topbar-account").innerText(), "Account");
    assert.ok(session.log.requests.every(item => !item.url.includes("wp-workspace.js") && !item.url.includes("/apps/wp-account")), "signed-in read-only workspace must not load account mutation paths");
    results.push({ name: "signed_in_workspace_isolation", ...await audit(session.page, session.context, session.log, "signed_in") });
    await session.page.locator("[data-open-agent-drawer]").first().click();
    const queries = ["desk organizer", "small apartment lamp", "ceramic travel mug", "cotton tote bag", "walnut display stand", "compact kitchen rack", "lightweight picnic blanket", "metal bookend", "reusable gift wrap", "canvas pencil case"];
    for (const query of queries) {
      await session.page.locator("[data-agent-input]").fill(query);
      const response = session.page.waitForResponse(value => new URL(value.url()).pathname.endsWith("/api/runs"));
      await session.page.locator("[data-agent-send]").click();
      const receipt = await response;
      assert.equal(receipt.status(), 200, query);
      await session.page.waitForFunction(() => document.querySelector("[data-agent-input]")?.value === "");
      assert.equal(await session.page.locator(".wp-agent-product").count(), 1, query);
    }
    results.push({ name: "ten_injected_read_only_journeys", count: queries.length, live: false,
      ...await audit(session.page, session.context, session.log, "ten_injected_read_only_journeys") });
  } finally { await session.context.close(); }
  preview.setScenario("ready");
  session = await newPage(browser, viewport);
  try {
    await load(session.page, "/collections/all");
    assert.equal(await session.page.locator(".sfc-collection-card").count(), 1);
    assert.match(await session.page.locator(".sfc-collection-card").innerText(), /Native Liquid product/u);
    assert.equal(await session.page.locator("[data-live-catalog]").count(), 0);
    assert.equal(await session.page.locator('.sfc-collection-card img[src*="unapproved.example.invalid"]').count(), 0);
    results.push({ name: "native_liquid_collection_no_legacy_catalog", ...await audit(session.page, session.context, session.log, "collection") });
  } finally { await session.context.close(); }
  return results;
}
