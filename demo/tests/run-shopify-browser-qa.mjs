import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { startDemo } from "../server.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const localQaModules = path.join(repoRoot, "scripts", ".qa-deps", "node_modules");
const require = createRequire(import.meta.url);

async function loadPlaywright() {
  try { return await import("playwright-core"); }
  catch { return import(pathToFileURL(path.join(localQaModules, "playwright-core", "index.mjs")).href); }
}

async function loadAxeSource() {
  try { return await readFile(require.resolve("axe-core/axe.min.js"), "utf8"); }
  catch { return readFile(path.join(localQaModules, "axe-core", "axe.min.js"), "utf8"); }
}

const { chromium, firefox, webkit } = await loadPlaywright();
const axeSource = await loadAxeSource();
const engines = { chromium, firefox, webkit };
const drawerFocusableSelector = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1']):not([disabled])",
].join(",");
const allRequested = process.argv.includes("--all");
const explicit = process.argv.find((argument) => argument.startsWith("--browser="));
const requested = allRequested ? Object.keys(engines) : [explicit?.slice("--browser=".length) || "chromium"];
if (requested.some((name) => !engines[name])) throw new Error("unknown_browser_engine");

const fake = await startFakeS1();
const demo = await startDemo({
  mode: "shopify",
  port: 0,
  agentCoreSandboxUrl: fake.baseUrl,
  agentCoreSandboxToken: "fake_browser_qa_sandbox_token",
  storefrontOrigin: "https://sandbox-store.example.invalid",
});

const results = [];
try {
  for (const name of requested) {
    const browser = await launch(name);
    try {
      for (const viewport of [
        { name: "desktop", width: 1440, height: 1000 },
        { name: "mobile", width: 390, height: 844 },
      ]) results.push(await runCase(browser, name, viewport));
    } finally {
      await browser.close();
    }
  }
  process.stdout.write(`${JSON.stringify({ ok: true, cases: results }, null, 2)}\n`);
} finally {
  await demo.close();
  await fake.close();
}

async function existingPath(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    try { await access(candidate); return candidate; }
    catch {}
  }
  return "";
}

async function launch(name) {
  const executablePath = name === "chromium"
    ? await existingPath([
        process.env.CHROME_PATH,
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      ])
    : name === "firefox"
      ? await existingPath([process.env.FIREFOX_PATH])
      : String(process.env.WEBKIT_PATH || "");
  const options = {
    headless: true,
    timeout: 20_000,
    ...(executablePath ? { executablePath } : {}),
    ...(name === "chromium" ? {
      args: [
        "--no-sandbox", "--disable-background-networking", "--disable-component-update",
        "--disable-default-apps", "--disable-extensions", "--disable-sync", "--no-first-run",
      ],
    } : {}),
  };
  try { return await engines[name].launch(options); }
  catch (error) {
    throw new Error(`${name}_browser_unavailable:${String(error?.message || "launch_failed").split("\n")[0]}`);
  }
}

async function drawerFocusState(page) {
  return page.evaluate((selector) => {
    const drawer = document.querySelector(".drawer");
    const focusables = [...drawer.querySelectorAll(selector)].filter((element) => {
      const style = getComputedStyle(element);
      return element.tabIndex >= 0 && element.getClientRects().length > 0
        && style.visibility !== "hidden" && style.display !== "none";
    });
    const active = document.activeElement;
    const background = [...document.querySelectorAll("body > header, body > main")];
    return {
      activeInside: active === drawer || drawer.contains(active),
      activeAtFirst: active === focusables[0],
      activeAtLast: active === focusables.at(-1),
      backgroundCount: background.length,
      backgroundInert: background.every((element) => element.inert),
      drawerTabIndex: drawer.tabIndex,
      focusableCount: focusables.length,
      submitDisabled: drawer.querySelector("[data-run-button]").disabled,
    };
  }, drawerFocusableSelector);
}

async function assertDrawerFocusCycle(page, label, submitDisabled) {
  let state = await drawerFocusState(page);
  assert.equal(state.activeInside, true, `${label}: initial focus escaped the dialog`);
  assert.equal(state.backgroundCount, 2, `${label}: expected header and main background regions`);
  assert.equal(state.backgroundInert, true, `${label}: background remained keyboard reachable`);
  assert.equal(state.submitDisabled, submitDisabled, `${label}: unexpected submit disabled state`);
  assert.ok(state.focusableCount > 1, `${label}: expected multiple dialog controls`);

  await page.evaluate((selector) => {
    const focusables = [...document.querySelector(".drawer").querySelectorAll(selector)].filter((element) => (
      element.tabIndex >= 0 && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== "hidden"
    ));
    focusables.at(-1).focus();
  }, drawerFocusableSelector);
  await page.keyboard.press("Tab");
  state = await drawerFocusState(page);
  assert.equal(state.activeInside, true, `${label}: Tab escaped the dialog`);
  assert.equal(state.activeAtFirst, true, `${label}: Tab did not wrap to the first control`);

  await page.evaluate((selector) => {
    const focusables = [...document.querySelector(".drawer").querySelectorAll(selector)].filter((element) => (
      element.tabIndex >= 0 && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== "hidden"
    ));
    focusables[0].focus();
  }, drawerFocusableSelector);
  await page.keyboard.press("Shift+Tab");
  state = await drawerFocusState(page);
  assert.equal(state.activeInside, true, `${label}: Shift+Tab escaped the dialog`);
  assert.equal(state.activeAtLast, true, `${label}: Shift+Tab did not wrap to the last control`);
  return state.focusableCount;
}

async function assertDrawerFallbackFocus(page, label) {
  const drawer = page.locator(".drawer");
  await drawer.locator("button, input, select, textarea").evaluateAll((elements) => {
    for (const element of elements) {
      element.dataset.qaPreviousDisabled = String(element.disabled);
      element.disabled = true;
    }
  });
  try {
    await drawer.focus();
    await page.keyboard.press("Tab");
    const state = await drawerFocusState(page);
    assert.equal(state.drawerTabIndex, -1, `${label}: dialog lacks programmatic fallback focus`);
    assert.equal(state.focusableCount, 0, `${label}: expected no enabled child controls`);
    assert.equal(state.activeInside, true, `${label}: empty dialog lost focus containment`);
  } finally {
    await drawer.locator("[data-qa-previous-disabled]").evaluateAll((elements) => {
      for (const element of elements) {
        element.disabled = element.dataset.qaPreviousDisabled === "true";
        delete element.dataset.qaPreviousDisabled;
      }
    });
  }
}

async function assertDrawerLiveFocusables(page, label) {
  const before = await drawerFocusState(page);
  await page.locator(".drawer").evaluate((drawer) => {
    const negativeTabStop = document.createElement("button");
    negativeTabStop.type = "button";
    negativeTabStop.tabIndex = -2;
    negativeTabStop.dataset.qaNegativeTabStop = "true";
    negativeTabStop.textContent = "Negative tab stop";
    drawer.append(negativeTabStop);
  });
  try {
    await page.evaluate((selector) => {
      const focusables = [...document.querySelector(".drawer").querySelectorAll(selector)].filter((element) => (
        element.tabIndex >= 0 && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== "hidden"
      ));
      focusables[0].focus();
    }, drawerFocusableSelector);
    await page.keyboard.press("Shift+Tab");
    let state = await drawerFocusState(page);
    assert.equal(state.activeAtLast, true, `${label}: negative tabindex entered the reverse cycle`);

    const mutation = await page.evaluate((selector) => {
      const focusables = [...document.querySelector(".drawer").querySelectorAll(selector)].filter((element) => (
        element.tabIndex >= 0 && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== "hidden"
      ));
      const formerLast = focusables.at(-1);
      formerLast.dataset.qaPreviousDisabled = String(formerLast.disabled);
      formerLast.disabled = true;
      const updated = focusables.filter((element) => element !== formerLast);
      updated.at(-1).focus();
      return { before: focusables.length, after: updated.length };
    }, drawerFocusableSelector);
    await page.keyboard.press("Tab");
    state = await drawerFocusState(page);
    assert.equal(mutation.before, before.focusableCount, `${label}: negative tabindex changed the tab order`);
    assert.equal(mutation.after, before.focusableCount - 1, `${label}: endpoint was not disabled`);
    assert.equal(state.focusableCount, mutation.after, `${label}: focusable list was not recomputed`);
    assert.equal(state.activeAtFirst, true, `${label}: Tab did not wrap after endpoint mutation`);
  } finally {
    await page.locator(".drawer [data-qa-previous-disabled]").evaluateAll((elements) => {
      for (const element of elements) {
        element.disabled = element.dataset.qaPreviousDisabled === "true";
        delete element.dataset.qaPreviousDisabled;
      }
    });
    await page.locator(".drawer [data-qa-negative-tab-stop]").evaluateAll((elements) => {
      for (const element of elements) element.remove();
    });
  }
}

async function assertEscapeRestoresOpener(page, opener, label, expectedBackgroundInert = [false, false]) {
  await page.keyboard.press("Escape");
  await page.locator(".drawer").waitFor({ state: "hidden" });
  assert.equal(await opener.evaluate((element) => document.activeElement === element), true,
    `${label}: Escape did not restore the exact opener`);
  const backgroundInert = await page.evaluate(() => (
    [...document.querySelectorAll("body > header, body > main")].map((element) => element.inert)
  ));
  assert.deepEqual(backgroundInert, expectedBackgroundInert,
    `${label}: background inert state was not restored`);
}

async function assertCatalogSearchRestoresOpener(page, label) {
  const form = page.locator("[data-catalog-search]");
  const opener = form.locator("button");
  const previousStyle = await form.getAttribute("style");
  // The responsive header hides this form on mobile; expose it only while QA exercises its submitter path.
  await form.evaluate((element) => { element.style.display = "flex"; });
  try {
    await form.locator("input").fill("catalog keyboard query");
    await opener.click();
    await page.locator(".drawer").waitFor({ state: "visible" });
    assert.equal(await page.locator(".drawer [data-run-query]").inputValue(), "catalog keyboard query",
      `${label}: catalog query was not transferred to the dialog`);
    await assertEscapeRestoresOpener(page, opener, label);
  } finally {
    await form.evaluate((element, style) => {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }, previousStyle);
  }
}

async function runCase(browser, browserName, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  await context.addInitScript({ content: axeSource });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];
  let runResponse;
  let runRequest;
  let releaseRuntime;
  const runtimeGate = new Promise((resolve) => { releaseRuntime = resolve; });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    requests.push(request.url());
    if (new URL(request.url()).pathname.endsWith("/api/runs")) runRequest = request;
  });
  page.on("response", async (response) => {
    if (new URL(response.url()).pathname.endsWith("/api/runs")) {
      runResponse = JSON.parse(await response.text());
    }
  });

  try {
    const runtimeRequest = page.waitForRequest((request) => (
      new URL(request.url()).pathname.endsWith("/api/runtime/status")
    ));
    await page.route("**/api/runtime/status", async (route) => {
      await runtimeGate;
      await route.continue();
    }, { times: 1 });
    await page.goto(`${demo.baseUrl}/`, { waitUntil: "domcontentloaded" });
    await runtimeRequest;

    const main = page.locator("body > main");
    await main.evaluate((element) => { element.inert = true; });
    let preRuntimeFocusableCount;
    try {
      const preRuntimeOpener = page.locator("[data-open-agent]").first();
      await preRuntimeOpener.click();
      await page.locator(".drawer").waitFor({ state: "visible" });
      preRuntimeFocusableCount = await assertDrawerFocusCycle(
        page, `${browserName}/${viewport.name}/pre-runtime`, true,
      );
      await assertDrawerFallbackFocus(page, `${browserName}/${viewport.name}/pre-runtime`);
      await assertEscapeRestoresOpener(
        page, preRuntimeOpener, `${browserName}/${viewport.name}/pre-runtime`, [false, true],
      );
    } finally {
      await main.evaluate((element) => { element.inert = false; });
    }

    releaseRuntime();
    await page.locator('[data-runtime-ready="true"][data-connected="true"]').waitFor();
    await assertCatalogSearchRestoresOpener(page, `${browserName}/${viewport.name}/catalog-search`);
    await page.locator("#workbench-query").fill("desk organizer");
    await page.locator(".workbench-form [data-run-button]").click();
    await page.locator("[data-workbench-results] .result.is-shopify").waitFor();
    await page.waitForFunction(() => Boolean(window.__referenceStoreDemo?.lastRenderIdentity?.all));
    const connectedOpener = page.locator("[data-open-agent]").first();
    await connectedOpener.click();
    await page.locator(".drawer").waitFor({ state: "visible" });
    const connectedFocusableCount = await assertDrawerFocusCycle(
      page, `${browserName}/${viewport.name}/connected`, false,
    );
    await assertDrawerLiveFocusables(page, `${browserName}/${viewport.name}/connected`);

    const state = await page.evaluate(async () => {
      const active = window.__referenceStoreDemo.getActiveRun();
      const receipt = JSON.parse(document.querySelector("[data-runs-receipt]").textContent);
      const axeResult = await window.axe.run(document, { resultTypes: ["violations"] });
      const databases = indexedDB.databases ? await indexedDB.databases() : [];
      const drawer = document.querySelector(".drawer").getBoundingClientRect();
      return {
        receipt,
        frozen: Object.isFrozen(active) && Object.isFrozen(active.runtime)
          && Object.isFrozen(active.search) && active.search.results.every(Object.isFrozen),
        identity: window.__referenceStoreDemo.lastRenderIdentity,
        workbenchText: document.querySelector("[data-workbench-results]").textContent,
        drawerText: document.querySelector("[data-drawer-results]").textContent,
        links: [...document.querySelectorAll(".verified-product-link")].map((link) => ({
          href: link.href, text: link.textContent,
        })),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        drawerWidth: drawer.width,
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
        storage: {
          local: localStorage.length,
          session: sessionStorage.length,
          indexedDb: databases.length,
        },
        seriousAxe: axeResult.violations.filter((violation) => (
          violation.impact === "serious" || violation.impact === "critical"
        )).map((violation) => ({
          id: violation.id,
          nodes: violation.nodes.map((node) => node.target),
        })),
      };
    });

    assert.ok(runResponse, `${browserName}/${viewport.name}: missing BFF run response`);
    assert.deepEqual(state.receipt, runResponse, `${browserName}/${viewport.name}: receipt changed BFF facts`);
    assert.deepEqual(runRequest.postDataJSON(), { query: "desk organizer" });
    assert.equal(state.frozen, true);
    assert.equal(state.identity.all, true);
    assert.match(state.workbenchText, /Shopify verified USD 19\.95/u);
    assert.match(state.drawerText, /Shopify availableForSaletrue/u);
    assert.equal(state.links.length, 2);
    assert.ok(state.links.every((link) => (
      link.href === "https://sandbox-store.example.invalid/products/verified-desk-organizer"
      && link.text === "Open verified Shopify product"
    )));
    assert.ok(state.overflow <= 1, `${browserName}/${viewport.name}: overflow ${state.overflow}`);
    if (viewport.name === "mobile") {
      assert.ok(Math.abs(state.drawerWidth - viewport.width) <= 1,
        `${browserName}/mobile: sheet width ${state.drawerWidth}`);
    }
    assert.equal(state.reducedMotion, true);
    assert.deepEqual(state.storage, { local: 0, session: 0, indexedDb: 0 });
    assert.deepEqual(state.seriousAxe, []);
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(pageErrors, []);
    const allowedOrigin = new URL(demo.baseUrl).origin;
    assert.ok(requests.every((url) => new URL(url).origin === allowedOrigin),
      `${browserName}/${viewport.name}: external request detected`);
    assert.deepEqual(await context.cookies(), []);
    await assertEscapeRestoresOpener(page, connectedOpener, `${browserName}/${viewport.name}/connected`);
    return {
      browser: browserName,
      viewport: `${viewport.width}x${viewport.height}`,
      overflow: state.overflow,
      console_errors: 0,
      external_requests: 0,
      axe_serious_critical: 0,
      reduced_motion: true,
      receipt_exact: true,
      focus_contained_pre_runtime: true,
      focus_contained_connected: true,
      focus_restored_on_escape: true,
      catalog_search_focus_restored: true,
      background_inert_while_open: true,
      prior_background_inert_restored: true,
      dynamic_focusables_recomputed: true,
      negative_tabindex_excluded: true,
      pre_runtime_submit_disabled: true,
      pre_runtime_focusable_count: preRuntimeFocusableCount,
      connected_focusable_count: connectedFocusableCount,
    };
  } finally {
    releaseRuntime();
    await context.close();
  }
}

async function startFakeS1() {
  const checked = "2026-08-31T00:00:00.000Z";
  const verified = "2026-08-31T00:00:01.000Z";
  const caps = {
    doctor: true, catalog_search: true, search_contract_v2: true, product_detail: true,
    storefront_health: true, cart: false, checkout: false, order: false, payment: false,
    inventory: false, publication: false, product_mutation: false,
  };
  const status = {
    contract: "shopify-live-sandbox-status/v1", mode: "shopify_read_only", verified: true,
    credential_state: "succeeded", data_source: "shopify_storefront_graphql", api_version: "2026-07",
    quota: { limit: 100, remaining: 97, window_seconds: 60, concurrency_limit: 4, reset_at: checked },
    writes: false, non_transactional: true, capabilities: caps, checked_at: checked, error_code: null,
    purchasable: false, shipping_rates: false, commerce_writes: false, credential_exposed: false,
  };
  const product = {
    public_id: "0123456789abcdefABCDEF", slug: "verified-desk-organizer",
    handle: "verified-desk-organizer", title: "Verified desk organizer",
    description: "Published Shopify product data.", images: [], price: { amount: 19.95, currency: "USD" },
    availability_band: "in_stock", as_of: verified, purchasable: false,
    product_url: "https://sandbox-store.example.invalid/products/verified-desk-organizer",
    availableForSale: true, shopify_verified_at: verified, non_transactional: true,
    transaction_boundary: "catalog_read_only_non_transactional", writes: false,
    mode: "shopify_read_only", data_source: "shopify_storefront_graphql",
    illustrative_only: false, available: false,
  };
  const search = {
    contract_version: "2.0", trace_id: "browser-qa-trace", status: "results",
    normalized_intent: {
      product_identity: { name: "product_identity", value: "desk organizer", source: "explicit", scope: "product", hardness: "hard" },
      hard_constraints: [], soft_context: [], transaction_context: [],
    },
    relaxations: [], missing_criteria: [], results: [product],
    pagination: { limit: 20, cursor: null, next_cursor: null, has_more: false },
    search_scope: {
      plan_complete: true, scope_exhausted: true, global_catalog_exhaustive: false,
      scan_limit_reached: false, degraded: false, degraded_reason: null,
    },
    compatibility: { adapter: "product_search_v1", legacy_status: "catalog_match" },
    mode: "shopify_read_only", data_source: "shopify_storefront_graphql", illustrative_only: false,
    purchasable: false, available: false, writes: false, non_transactional: true,
    transaction_boundary: "catalog_read_only_non_transactional", shopify_verified_at: verified,
  };
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/sandbox/status") response.end(JSON.stringify(status));
    else if (request.method === "POST" && request.url === "/sandbox/api/search/v2") response.end(JSON.stringify(search));
    else response.writeHead(404).end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
