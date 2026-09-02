import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import bff from "../storefront-bff/src/index.js";
import { assertAcceptedAgentCore, readPairedGit } from "./paired-integration-smoke.mjs";
import { resolveShopifyAgentCoreDirectory, loadStartVerifiedShopifySandbox } from "./demo-shopify.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STOREFRONT = "https://sandbox-store.example.invalid";
const PROXY_SECRET = "visibly_fake_paired_app_proxy_secret";
const SHOPIFY_TOKEN = "visibly_fake_paired_shopify_read_token";
const FORBIDDEN = [PROXY_SECRET, SHOPIFY_TOKEN];
const CASES = Object.freeze([
  { id: "paired_shopify_01_public_image_price", query: "demo product" },
  { id: "paired_shopify_02_sold_out", query: "sold out demo product", available: false },
  { id: "paired_shopify_03_terminal_miss", query: "absent public fixture", empty: true },
  { id: "paired_shopify_04_no_media", query: "demo product without image", images: false },
  { id: "paired_shopify_05_zero_price", query: "zero price public fixture", amount: "0.00" },
  { id: "paired_shopify_06_multiple_images", query: "demo product gallery", secondImage: true },
  { id: "paired_shopify_07_public_options", query: "stainless steel demo product" },
  { id: "paired_shopify_08_currency", query: "euro public fixture", currency: "EUR" },
  { id: "paired_shopify_09_bounded_limit", query: "one public fixture", limit: 1 },
  { id: "paired_shopify_10_unicode_query", query: "公开演示商品" },
]);

function signedProxyUrl(route, shop) {
  const params = new URLSearchParams({
    shop, timestamp: String(Math.floor(Date.now() / 1_000)), path_prefix: "/apps/reference-store",
  });
  const message = [...params].map(([key, value]) => `${key}=${value}`).sort().join("");
  params.set("signature", createHmac("sha256", PROXY_SECRET).update(message).digest("hex"));
  return `https://proxy.example.invalid${route}?${params}`;
}

function assertCredentialIsolation(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const token of FORBIDDEN) {
    assert.equal(text.includes(token), false, "server fixture credential must not reach the browser or artifact");
    assert.equal(text.includes(encodeURIComponent(token)), false);
    assert.equal(text.includes(Buffer.from(token).toString("base64")), false);
  }
}

function checkRuntime(runtime) {
  assert.equal(runtime.contract, "reference-store-runtime-status/v1");
  assert.equal(runtime.mode, "shopify_read_only");
  assert.equal(runtime.connected, true);
  assert.equal(runtime.credential_state, "succeeded");
  assert.equal(runtime.data_source, "shopify_storefront_graphql");
  assert.equal(runtime.writes_disabled, true);
  assert.equal(runtime.capabilities.catalog_search, true);
  assert.equal(runtime.capabilities.search_contract_v2, true);
  assert.deepEqual(runtime.boundaries, {
    non_transactional: true, purchasable: false, shipping_rates: false,
    commerce_writes: false, credential_exposed: false,
  });
}

export async function runPairedShopifySmoke({ args = process.argv.slice(2) } = {}) {
  const directory = await resolveShopifyAgentCoreDirectory({ args });
  const accepted = await assertAcceptedAgentCore(directory);
  const repositories = {
    reference_store: {
      commit: readPairedGit(root, ["rev-parse", "HEAD"]),
      tree: readPairedGit(root, ["rev-parse", "HEAD^{tree}"]),
      working_tree: readPairedGit(root, ["status", "--porcelain=v1", "--untracked-files=normal"])
        ? "dirty" : "clean",
    },
    agent_core: accepted,
  };
  // Both imports are from the exact accepted clean checkout; fixtures are public
  // source data, never captured merchant responses. No command writes in Core.
  const startVerified = await loadStartVerifiedShopifySandbox(directory);
  const fixtures = await import(pathToFileURL(
    path.join(directory, "sandbox/tests/helpers/shopify-fixtures.mjs"),
  ).href);
  const counts = { core_status: 0, core_search: 0, injected_health: 0, injected_readiness_catalog: 0, injected_catalog: 0, external: 0 };
  const outcomes = [];
  let activeCase = null;
  let expectedProduct = null;
  let coreOrigin = "";
  let coreToken = "";
  let sandbox;
  const nativeFetch = globalThis.fetch;

  // Only the actual loopback Core transport may use fetch. Shopify's HTTPS
  // request is intercepted by its explicit provider fetchImpl below.
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!coreOrigin || url.origin !== coreOrigin || url.hostname !== "127.0.0.1"
      || url.search || url.hash) {
      counts.external += 1;
      throw new Error("paired_shopify_external_network_blocked");
    }
    if (request.method === "GET" && url.pathname === "/sandbox/status") counts.core_status += 1;
    else if (request.method === "POST" && url.pathname === "/sandbox/api/search/v2") {
      counts.core_search += 1;
      const contract = await request.clone().json();
      assert.equal(contract.contract_version, "2.0");
      assert.equal(contract.product_identity.value, activeCase.query);
      assert.deepEqual(contract.hard_constraints, []);
    } else throw new Error("paired_shopify_unapproved_core_route");
    assert.equal(request.headers.get("authorization"), coreToken ? `Bearer ${coreToken}` : null);
    assert.equal(request.headers.get("x-shopify-storefront-access-token"), null);
    assert.equal(request.headers.get("cookie"), null);
    return nativeFetch(request);
  };

  const injectedShopifyFetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.origin, `https://${fixtures.FIXTURE_STORE}`);
    assert.equal(url.pathname, "/api/2026-07/graphql.json");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("x-shopify-storefront-access-token"), SHOPIFY_TOKEN);
    assert.equal(request.headers.get("authorization"), null);
    const body = await request.json();
    assert.match(body.query, /^query /u);
    assert.doesNotMatch(body.query, /\bmutation\b/iu);
    if (body.operationName === "ShopifySandboxHealth") {
      counts.injected_health += 1;
      return fixtures.jsonResponse(fixtures.healthPayload());
    }
    assert.equal(body.operationName, "ShopifySandboxCatalog");
    if (body.variables.query === null) {
      assert.equal(body.variables.first, 1);
      assert.equal(body.variables.after, null);
      counts.injected_readiness_catalog += 1;
      const probe = fixtures.productNode();
      return fixtures.jsonResponse(fixtures.catalogPayload([{
        ...probe, onlineStoreUrl: STOREFRONT + "/products/" + probe.handle,
      }]));
    }
    assert.ok(activeCase, "catalog requests require an active public fixture journey");
    assert.equal(body.variables.first, activeCase.limit || 3);
    assert.equal(body.variables.after, null);
    counts.injected_catalog += 1;
    return fixtures.jsonResponse(fixtures.catalogPayload(activeCase.empty ? [] : [expectedProduct]));
  };

  try {
    const started = await startVerified({
      port: 0, host: "127.0.0.1",
      environment: {
        SHOPIFY_STORE_DOMAIN: fixtures.FIXTURE_STORE,
        SHOPIFY_STOREFRONT_ACCESS_TOKEN: SHOPIFY_TOKEN,
      },
      fetchImpl: injectedShopifyFetch,
    });
    assert.equal(started.status.verified, true);
    assert.equal(started.status.mode, "shopify_read_only");
    sandbox = started.sandbox;
    assert.ok(sandbox, "actual accepted Core must start with injected read-only Shopify");
    coreOrigin = new URL(sandbox.baseUrl).origin;
    coreToken = String(sandbox.token || "");
    if (coreToken) FORBIDDEN.push(coreToken);
    const env = {
      AGENT_CORE_SANDBOX_URL: sandbox.baseUrl,
      ...(coreToken ? { AGENT_CORE_SANDBOX_TOKEN: coreToken } : {}),
      BFF_RUNTIME_MODE: "shopify_read_only",
      BFF_DEPLOYMENT_MODE: "shopify_app_proxy",
      SHOPIFY_APP_PROXY_SECRET: PROXY_SECRET,
      SHOPIFY_APP_PROXY_SHOP: fixtures.FIXTURE_STORE,
      STOREFRONT_ORIGIN: STOREFRONT,
      ALLOWED_ORIGINS: STOREFRONT,
    };
    const proxyCall = async (route, body, { invalidSignature = false } = {}) => {
      const url = new URL(signedProxyUrl(route, fixtures.FIXTURE_STORE));
      if (invalidSignature) url.searchParams.set("signature", "0".repeat(64));
      const response = await bff.fetch(new Request(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin: STOREFRONT,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), env);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("set-cookie"), null);
      const text = await response.text();
      assertCredentialIsolation(text);
      assertCredentialIsolation([...response.headers]);
      return { status: response.status, body: JSON.parse(text) };
    };

    const rejected = await proxyCall("/api/runtime/status", undefined, { invalidSignature: true });
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error, "app_proxy_authentication_failed");
    assert.equal(counts.core_status, 0);
    const status = await proxyCall("/api/runtime/status");
    assert.equal(status.status, 200);
    checkRuntime(status.body);
    const doctor = await proxyCall("/api/runtime/doctor");
    assert.equal(doctor.status, 200);
    assert.equal(doctor.body.contract, "reference-store-runtime-doctor/v1");
    assert.equal(doctor.body.ok, true);
    assert.ok(Object.values(doctor.body.checks).every((value) => value === true));
    checkRuntime(doctor.body.runtime);

    for (const journey of CASES) {
      activeCase = journey;
      const base = fixtures.productNode();
      expectedProduct = fixtures.productNode({
        onlineStoreUrl: `${STOREFRONT}/products/${base.handle}`,
        availableForSale: journey.available !== false,
        images: {
          nodes: journey.images === false ? [] : [
            ...base.images.nodes,
            ...(journey.secondImage ? [{
              url: "https://cdn.shopify.com/s/files/1/public-fixture-second.jpg", altText: "Second public fixture",
            }] : []),
          ],
        },
        priceRange: { minVariantPrice: {
          amount: journey.amount || "19.95", currencyCode: journey.currency || "USD",
        } },
      });
      const result = await proxyCall("/api/runs", { query: journey.query, limit: journey.limit || 3 });
      assert.equal(result.status, 200, journey.id);
      assert.equal(result.body.contract, "reference-store-read-run/v1");
      checkRuntime(result.body.runtime);
      const search = result.body.search;
      assert.equal(search.status, journey.empty ? "no_match" : "results", journey.id);
      assert.equal(search.normalized_intent.product_identity.value, journey.query);
      assert.equal(search.search_scope.plan_complete, true);
      assert.equal(search.search_scope.scope_exhausted, true);
      assert.equal(search.search_scope.degraded, false);
      assert.equal(search.pagination.has_more, false);
      assert.equal(search.results.length, journey.empty ? 0 : 1);
      if (!journey.empty) {
        const product = search.results[0];
        assert.equal(product.handle, expectedProduct.handle);
        assert.equal(product.title, expectedProduct.title);
        assert.equal(product.summary, expectedProduct.description);
        assert.equal(product.image, expectedProduct.images.nodes[0]?.url || "");
        assert.deepEqual(product.price, {
          amount: Number(expectedProduct.priceRange.minVariantPrice.amount),
          currency: expectedProduct.priceRange.minVariantPrice.currencyCode,
        });
        assert.equal(product.available_for_sale, expectedProduct.availableForSale);
        assert.equal(product.product_url, expectedProduct.onlineStoreUrl);
        assert.ok(Number.isFinite(Date.parse(product.shopify_verified_at)));
        assert.equal(product.synthetic, false);
        assert.equal(product.non_transactional, true);
        for (const field of ["purchasable", "writes", "shipping_rates"]) assert.equal(product[field], false);
      }
      outcomes.push({ case_id: journey.id, status: "passed" });
    }
    const beforeLegacy = counts.core_status + counts.core_search;
    for (const route of ["/api/chat", "/api/search", "/api/catalog"]) {
      const rejectedLegacy = await proxyCall(route, {});
      assert.equal(rejectedLegacy.status, 404);
      assert.equal(rejectedLegacy.body.expected_mode, "shopify_read_only");
    }
    assert.equal(counts.core_status + counts.core_search, beforeLegacy);
    assert.equal(counts.core_search, 10);
    assert.equal(counts.injected_catalog, 10);
    assert.equal(counts.core_status, 12);
    assert.ok(counts.injected_health >= 1);
    assert.equal(counts.external, 0);
  } finally {
    await sandbox?.close().catch(() => {});
    globalThis.fetch = nativeFetch;
    await assertAcceptedAgentCore(directory);
  }

  const artifact = {
    schema_version: "reference-store-paired-shopify-injected/v1",
    generated_at: new Date().toISOString(),
    provenance: "public_injected_shopify_via_actual_core_and_bff",
    repositories,
    boundaries: {
      live_shopify_connection_verified: false,
      actual_shopify_app_proxy_verified: false,
      external_network_request_count: counts.external,
      successful_commerce_write_count: 0,
      production_record_count: 0,
      credentials_exposed: false,
    },
    summary: { status: "passed", passed_count: outcomes.length, total_count: CASES.length },
    counts,
    journeys: outcomes,
  };
  assertCredentialIsolation(artifact);
  const output = path.join(root, "build/paired-shopify-smoke/artifact.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return { artifact, output };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPairedShopifySmoke().then(({ artifact }) => {
    process.stdout.write(`PASS: paired Shopify injected ${artifact.summary.passed_count}/${artifact.summary.total_count}; actual Core + signed BFF; no live Shopify claim.\n`);
    process.stdout.write(`Agent Core SHA: ${artifact.repositories.agent_core.commit}\n`);
    process.stdout.write("Sanitized artifact: build/paired-shopify-smoke/artifact.json\n");
  }).catch(() => {
    process.stderr.write("FAIL: paired Shopify injected gate; no request, response, host, or credential details were emitted.\n");
    process.exitCode = 1;
  });
}