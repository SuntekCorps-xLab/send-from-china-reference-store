import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import worker from "../../storefront-bff/src/index.js";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const themeRoot = path.join(repoRoot, "shopify-theme");
const { Liquid } = require("liquidjs");
export const PROXY_PREFIX = "/apps/reference-store";
export const SERVER_ONLY_SENTINELS = [
  "visibly_fake_liquid_core_credential",
  "visibly_fake_liquid_proxy_signing_secret",
];
const STOREFRONT = "https://sandbox-store.example.invalid";
const FIXTURE_SHOP = "reference-liquid-fixture.myshopify.com";
const CHECKED = "2026-09-02T00:00:00.000Z";
const VERIFIED = "2026-09-02T00:00:01.000Z";

function statusFixture(scenario) {
  if (scenario === "synthetic_mismatch") {
    const synthetic = statusFixture("ready");
    return { ...synthetic, mode: "synthetic_local_sandbox", credential_state: "mock_ready",
      data_source: "synthetic_fixture", api_version: null,
      quota: { limit: 0, remaining: 0, window_seconds: 0, concurrency_limit: 0, reset_at: null },
      capabilities: { ...synthetic.capabilities, storefront_health: false } };
  }
  const connected = !["credential_missing", "permission_required"].includes(scenario);
  const state = connected ? "succeeded" : scenario;
  return {
    contract: "shopify-live-sandbox-status/v1", mode: "shopify_read_only", verified: connected,
    credential_state: state, data_source: "shopify_storefront_graphql", api_version: "2026-07",
    quota: { limit: 100, remaining: 97, window_seconds: 60, concurrency_limit: 4, reset_at: CHECKED },
    writes: false, non_transactional: true,
    capabilities: {
      doctor: true, catalog_search: connected, search_contract_v2: connected,
      product_detail: connected, storefront_health: connected,
      cart: false, checkout: false, order: false, payment: false,
      inventory: false, publication: false, product_mutation: false,
    },
    checked_at: CHECKED, error_code: connected ? null : state.toUpperCase(),
    purchasable: false, shipping_rates: false, commerce_writes: false, credential_exposed: false,
  };
}

function searchFixture(query) {
  return {
    contract_version: "2.0", trace_id: "liquid-injected-core-trace", status: "results",
    normalized_intent: {
      product_identity: { name: "product_identity", value: query, source: "explicit", scope: "product", hardness: "hard" },
      hard_constraints: [], soft_context: [], transaction_context: [],
    },
    relaxations: [], missing_criteria: [],
    results: [{
      public_id: "0123456789abcdefABCDEF", slug: "verified-desk-organizer", handle: "verified-desk-organizer",
      title: "Verified desk organizer", description: "Injected Shopify read-only fixture product.",
      images: [], price: { amount: 19.95, currency: "USD" }, availability_band: "in_stock",
      as_of: VERIFIED, purchasable: false,
      product_url: `${STOREFRONT}/products/verified-desk-organizer`,
      availableForSale: true, shopify_verified_at: VERIFIED, non_transactional: true,
      transaction_boundary: "catalog_read_only_non_transactional", writes: false,
      mode: "shopify_read_only", data_source: "shopify_storefront_graphql", illustrative_only: false, available: false,
    }],
    pagination: { limit: 20, cursor: null, next_cursor: null, has_more: false },
    search_scope: {
      plan_complete: true, scope_exhausted: true, global_catalog_exhaustive: false,
      scan_limit_reached: false, degraded: false, degraded_reason: null,
    },
    compatibility: { adapter: "product_search_v1", legacy_status: "catalog_match" },
    mode: "shopify_read_only", data_source: "shopify_storefront_graphql", illustrative_only: false,
    purchasable: false, available: false, writes: false, non_transactional: true,
    transaction_boundary: "catalog_read_only_non_transactional", shopify_verified_at: VERIFIED,
  };
}

function send(response, status, body, contentType = "application/json; charset=utf-8") {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}

function signedProxyUrl(pathname) {
  const params = new URLSearchParams({
    shop: FIXTURE_SHOP, timestamp: String(Math.floor(Date.now() / 1000)),
    path_prefix: PROXY_PREFIX, logged_in_customer_id: "",
  });
  const message = [...params.keys()].sort().map(key => `${key}=${params.get(key)}`).join("");
  params.set("signature", createHmac("sha256", SERVER_ONLY_SENTINELS[1]).update(message).digest("hex"));
  return `https://proxy.example.invalid${pathname}?${params}`;
}

export async function startLiquidPreview() {
  let scenario = "ready";
  const ingress = [];
  const upstream = [];
  const failures = [];
  const core = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      const authenticated = request.headers.authorization === `Bearer ${SERVER_ONLY_SENTINELS[0]}`;
      assert.equal(authenticated, true, "Core credential must remain on the server-to-server request");
      upstream.push({ method: request.method, pathname: request.url, authenticated, body });
      if (request.method === "GET" && request.url === "/sandbox/status") return send(response, 200, statusFixture(scenario));
      if (request.method === "POST" && request.url === "/sandbox/api/search/v2") {
        if (scenario === "upstream_failure") return send(response, 503, { error: "service_unavailable" });
        const input = JSON.parse(body);
        const result = searchFixture(input.q || input.query || "desk organizer");
        if (scenario === "degraded") {
          result.status = "degraded";
          result.results = [];
          result.search_scope = { ...result.search_scope, plan_complete: false, scope_exhausted: false,
            degraded: true, degraded_reason: "injected_upstream_timeout" };
        }
        return send(response, 200, result);
      }
      send(response, 404, { error: "fixture_route_not_found" });
    } catch (error) { failures.push(error.message); send(response, 500, { error: "fixture_failed" }); }
  });
  const coreOrigin = await listen(core);
  const engine = new Liquid({
    root: [path.join(themeRoot, "snippets"), path.join(themeRoot, "layout")],
    extname: ".liquid", strictFilters: true,
  });
  // Shopify's platform filters are supplied locally; the page markup and scripts
  // are always loaded from the actual repository Liquid files.
  engine.registerTag("paginate", {
    parse(token, remaining) {
      assert.equal(token.args.trim(), "collection.products by 24", "Preview paginator only supports the tested single-page collection");
      this.templates = [];
      const stream = this.liquid.parser.parseStream(remaining)
        .on("tag:endpaginate", () => stream.stop())
        .on("template", template => this.templates.push(template))
        .on("end", () => { throw new Error("Unclosed Shopify paginate tag"); });
      stream.start();
    },
    *render(context, emitter) {
      context.push({ paginate: { pages: 1, current_page: 1, parts: [], previous: null, next: null } });
      try { yield this.liquid.renderer.renderTemplates(this.templates, context, emitter); }
      finally { context.pop(); }
    },
  });
  engine.registerFilter("asset_url", value => `/assets/${encodeURIComponent(value)}`);
  engine.registerFilter("stylesheet_tag", value => `<link rel="stylesheet" href="${value}">`);
  engine.registerFilter("money", value => `$${(Number(value || 0) / 100).toFixed(2)}`);
  engine.registerFilter("money_without_currency", value => (Number(value || 0) / 100).toFixed(2));
  engine.registerFilter("json", value => JSON.stringify(value));
  engine.registerFilter("image_url", () => "/fixture-product.svg");
  engine.registerFilter("image_tag", value => `<img src="${value}" alt="" loading="lazy">`);

  let origin;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      if (url.pathname.startsWith(`${PROXY_PREFIX}/api/`)) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const rawBody = Buffer.concat(chunks).toString("utf8");
        const record = { method: request.method, pathname: url.pathname, body: rawBody, headers: { ...request.headers } };
        ingress.push(record);
        const bffResponse = await worker.fetch(new Request(signedProxyUrl(url.pathname.slice(PROXY_PREFIX.length)), {
          method: request.method,
          headers: { "content-type": request.headers["content-type"] || "application/json", origin },
          ...(request.method === "POST" ? { body: rawBody } : {}),
        }), {
          AGENT_CORE_SANDBOX_URL: coreOrigin, AGENT_CORE_SANDBOX_TOKEN: SERVER_ONLY_SENTINELS[0],
          BFF_RUNTIME_MODE: "shopify_read_only", BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
          SHOPIFY_APP_PROXY_SECRET: SERVER_ONLY_SENTINELS[1], SHOPIFY_APP_PROXY_SHOP: FIXTURE_SHOP,
          SHOPIFY_APP_PROXY_PATH_PREFIX: PROXY_PREFIX,
          STOREFRONT_ORIGIN: STOREFRONT, ALLOWED_ORIGINS: origin,
          BFF_QUOTA_LIMIT: "10000",
        });
        record.status = bffResponse.status;
        record.response = await bffResponse.text();
        return send(response, record.status, record.response);
      }
      if (url.pathname.startsWith("/assets/")) {
        const asset = decodeURIComponent(url.pathname.slice("/assets/".length));
        if (path.basename(asset) !== asset) return send(response, 400, "invalid asset");
        const content = await readFile(path.join(themeRoot, "assets", asset), "utf8");
        return send(response, 200, content, asset.endsWith(".css") ? "text/css" : "text/javascript");
      }
      if (url.pathname === "/favicon.ico") return send(response, 204, "", "image/x-icon");
      if (["/", "/search", "/pages/workspace", "/collections/all"].includes(url.pathname)) {
        const section = url.pathname === "/collections/all" ? "lm-collection" : url.pathname === "/search" ? "lm-search-chat" : url.pathname === "/pages/workspace" ? "wp-workspace" : "lm-home-chat";
        const context = {
          settings: { wp_runtime_mode: "shopify_read_only", wp_app_proxy_path: scenario === "cross_origin_config" ? "https://unapproved.example.invalid/apps/reference-store" : PROXY_PREFIX,
            wp_governance_api_base: "https://legacy.example.invalid", wp_workspace_url: "/pages/workspace" },
          shop: { name: "Liquid injected preview", currency: "USD", url: STOREFRONT, description: "Local Liquid preview" },
          request: { locale: { iso_code: "en" }, page_type: url.pathname === "/search" ? "search" : "index", origin },
          routes: { root_url: "/", search_url: "/search", account_url: "/account", cart_url: "/cart", all_products_collection_url: "/collections/all" },
          customer: scenario === "signed_in" ? { id: 123 } : null,
          collections: { all: { products: [] } }, cart: { item_count: 0, currency: { iso_code: "USD" } },
          search: { performed: Boolean(url.searchParams.get("q")), terms: url.searchParams.get("q") || "" },
          canonical_url: `${origin}${url.pathname}`, current_page: 1, page_title: "Liquid injected preview", content_for_header: "",
        };
        if (url.pathname === "/collections/all") {
          context.collection = {
            handle: "all", title: "Injected collection", description: "Single-page local Liquid fixture.",
            products_count: 1, default_sort_by: "manual", sort_options: [{ value: "manual", name: "Featured" }],
            products: [{ title: "Native Liquid product", url: "/products/native-liquid-product", type: "Organizer",
              available: true, price: 1995, price_min: 1995, price_varies: false,
              metafields: { wpai: { external_image_url: { value: "https://unapproved.example.invalid/legacy-image.jpg" } } } }],
          };
          context.collections.all = context.collection;
          context.request.page_type = "collection";
        }
        const source = await readFile(path.join(themeRoot, "sections", `${section}.liquid`), "utf8");
        // schema is Shopify editor metadata, not rendered storefront content.
        context.content_for_layout = await engine.parseAndRender(source.replace(/\{%\s*schema\s*%\}[\s\S]*?\{%\s*endschema\s*%\}/gu, ""), context, { globals: context });
        const html = await engine.renderFile("chat", context, { globals: context });
        assert.ok(!/\{[{%]/u.test(html), "Liquid output must not contain unrendered template syntax");
        return send(response, 200, html, "text/html; charset=utf-8");
      }
      send(response, 404, { error: "fixture_route_not_found" });
    } catch (error) { failures.push(error.message); send(response, 500, { error: "liquid_preview_failed", message: error.message }); }
  });
  origin = await listen(server);
  return {
    origin, ingress, upstream, failures,
    setScenario(value) { scenario = value; ingress.length = 0; upstream.length = 0; failures.length = 0; },
    async close() { await Promise.all([server, core].map(instance => new Promise(resolve => instance.close(resolve)))); },
  };
}
