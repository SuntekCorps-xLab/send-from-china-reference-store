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
    await page.goto(`${demo.baseUrl}/`, { waitUntil: "networkidle" });
    await page.locator('[data-runtime-ready="true"][data-connected="true"]').waitFor();
    await page.locator("#workbench-query").fill("desk organizer");
    await page.locator(".workbench-form [data-run-button]").click();
    await page.locator("[data-workbench-results] .result.is-shopify").waitFor();
    await page.waitForFunction(() => Boolean(window.__referenceStoreDemo?.lastRenderIdentity?.all));
    await page.locator("[data-open-agent]").first().click();
    await page.locator(".drawer").waitFor({ state: "visible" });

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
    return {
      browser: browserName,
      viewport: `${viewport.width}x${viewport.height}`,
      overflow: state.overflow,
      console_errors: 0,
      external_requests: 0,
      axe_serious_critical: 0,
      reduced_motion: true,
      receipt_exact: true,
    };
  } finally {
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
