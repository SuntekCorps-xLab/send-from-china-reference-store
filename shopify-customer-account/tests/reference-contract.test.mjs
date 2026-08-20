import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..", "..");

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

test("the repository contains one complete installable theme surface", () => {
  for (const path of [
    "shopify-theme/layout/theme.liquid",
    "shopify-theme/layout/chat.liquid",
    "shopify-theme/locales/en.default.json",
    "shopify-theme/templates/index.json",
    "shopify-theme/templates/search.json",
    "shopify-theme/templates/collection.json",
    "shopify-theme/templates/product.json",
    "shopify-theme/templates/cart.json",
  ]) assert.equal(existsSync(resolve(repositoryRoot, path)), true, path);
});

test("store-specific theme data and deployable app identity are excluded", () => {
  assert.equal(existsSync(resolve(repositoryRoot, "shopify-theme/config/settings_data.json")), false);
  const example = read("shopify-customer-account/shopify.app.toml.example");
  assert.match(example, /application_url = "https:\/\/example\.invalid"/);
  assert.match(example, /topics = \["orders\/paid"\]/);
  assert.match(example, /topics = \["refunds\/create"\]/);
  assert.doesNotMatch(example, /\.workers\.dev|\.myshopify\.com|client_secret|shpss_|shpat_|shptka_/i);
});

test("the agent drawer requires configuration and keeps sourcing explicit", () => {
  const drawer = read("shopify-theme/assets/wp-agent-drawer.js");
  const snippet = read("shopify-theme/snippets/wp-agent-drawer.liquid");
  assert.match(drawer, /root\.dataset\.publicApi \|\| ""/);
  assert.match(drawer, /Shopping Agent API is not configured/);
  assert.match(drawer, /data-agent-start-sourcing/);
  assert.match(drawer, /target\.searchParams\.set\("handoff_id"/);
  assert.match(drawer, /window\.location\.assign\(target\.href\)/);
  assert.match(snippet, /settings\.wp_governance_api_base/);
  assert.doesNotMatch(drawer + snippet, /wp-governance\.htfu\.workers\.dev/i);
});

test("search and collection avoid fixed catalog-total claims", () => {
  const search = read("shopify-theme/sections/lm-search-chat.liquid");
  const collection = read("shopify-theme/sections/lm-collection.liquid");
  assert.doesNotMatch(search, /topK\s*:\s*48|48 closest matches/i);
  assert.match(collection, /\/api\/catalog/);
  assert.match(collection, /nextCursor/);
  assert.match(collection, /Load more/);
});

test("product and cart keep Shopify as the commerce boundary", () => {
  const product = read("shopify-theme/sections/lm-pdp-chat.liquid");
  const cart = read("shopify-theme/sections/lm-cart-chat.liquid");
  assert.match(product, /routes\.cart_add_url/);
  assert.match(product, /name="id"/);
  assert.match(cart, /routes\.cart_change_url/);
  assert.match(cart, /name="checkout"/);
  assert.match(cart, /settings\.wp_shipping_api_base/);
  assert.doesNotMatch(cart, /wp-sfc-carrier\.htfu\.workers\.dev/i);
});

test("customer-account code contains no production host defaults", () => {
  const sources = [
    read("shopify-customer-account/extensions/wp-account/src/AccountPage.jsx"),
    read("shopify-customer-account/extensions/wp-ask/src/AskWpPage.jsx"),
    read("shopify-customer-account/extensions/wp-order-tracking/src/OrderIndexTracking.jsx"),
  ].join("\n");
  assert.match(sources, /https:\/\/example\.invalid/);
  assert.doesNotMatch(sources, /\.workers\.dev|landmarks\.builders/i);
});
