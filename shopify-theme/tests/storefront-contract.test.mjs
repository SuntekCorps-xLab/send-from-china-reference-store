import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inlineClassicScripts } from "./helpers/inline-scripts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const THEMES = ["shopify-theme"];

function read(theme, relativePath) {
  return readFileSync(resolve(ROOT, theme, relativePath), "utf8");
}

function parseJsonTemplate(theme, relativePath) {
  return JSON.parse(read(theme, relativePath).replace(/\/\*[\s\S]*?\*\//g, ""));
}

for (const theme of THEMES) {
  test(`${theme}: collection uses the single commerce shell`, () => {
    const template = parseJsonTemplate(theme, "templates/collection.json");
    const section = read(theme, "sections/lm-collection.liquid");
    assert.equal(template.layout, "chat");
    assert.doesNotMatch(section, /<main(?:\s|>)/i);
  });

  test(`${theme}: human pages do not expose developer view chrome or the old account host`, () => {
    const switcher = read(theme, "snippets/agent-view-switcher.liquid");
    const topbar = read(theme, "snippets/wp-shell-topbar.liquid");
    const footer = read(theme, "snippets/wp-shell-footer.liquid");
    const layout = read(theme, "layout/chat.liquid");
    assert.doesNotMatch(switcher, /View as AI agent|wp-global-track-link/);
    for (const source of [switcher, topbar, footer, layout]) {
      assert.doesNotMatch(source, /account\.worldproducts\.chat/i);
    }
  });

  test(`${theme}: home and search preserve truthful discovery behavior`, () => {
    const home = read(theme, "sections/lm-home-chat.liquid");
    const homeScript = read(theme, "assets/product-discovery-home.js");
    const search = read(theme, "sections/lm-search-chat.liquid");
    assert.match(home, /render 'wp-shell-topbar'/);
    assert.doesNotMatch(home, /<main(?:\s|>)/i);
    assert.match(home, /product\.price_varies/);
    assert.match(home, /for product in wp_live_products limit: 32/);
    assert.match(homeScript, /hasCustomerVisibleCjk/);
    assert.match(homeScript, /readableCards >= 8/);
    assert.match(search, /Number\.isFinite\(price\) && price > 0 && priceCurrency/);
    assert.match(search, /View current price/);
    assert.match(search, /data-currency="{{ shop\.currency/);
    assert.match(search, /data-search-results/);
    assert.match(search, /sfc-search-product-action/);
    assert.match(search, /Choose options/);
    assert.match(search, /View product/);
    assert.doesNotMatch(search, /Add to compare|Selected for comparison|data-search-shortlist/i);
    assert.match(search, /document\.createElement\("article"\)/);
    assert.doesNotMatch(search, /<main(?:\s|>)/i);
    const searchScripts = inlineClassicScripts(search);
    assert.equal(searchScripts.length, 1, "search has exactly one inline interaction script");
    const [inlineScript] = searchScripts;
    assert.ok(inlineScript, "search interaction script is present");
    assert.doesNotThrow(() => new Function(inlineScript.replace(/{{ wp_agent_url \| json }}/g, '"https://example.com/ask"')));
  });

  test(`${theme}: PDP cannot navigate to an empty variant and estimates the selected quantity`, () => {
    const source = read(theme, "sections/lm-pdp-chat.liquid");
    assert.match(source, /if target_variant_id != blank/);
    assert.match(source, /is-unavailable" aria-disabled="true"/);
    assert.match(source, /data-pdp-quantity/);
    assert.match(source, /Math\.max\(1, Math\.round\(num\(quantity && quantity\.value, 1\)\)\)/);
    assert.match(source, /pre\.onerror/);
    assert.match(source, /aria-live="polite"/);
    assert.match(source, /new AbortController\(\)/);
    assert.match(source, /signal: controller\.signal/);
    const scripts = inlineClassicScripts(source);
    assert.ok(scripts.length >= 2, "PDP interaction scripts are present");
    for (const script of scripts) {
      assert.doesNotThrow(() => new Function(script));
    }
  });

  test(`${theme}: cart keeps discount and currency arithmetic honest`, () => {
    const source = read(theme, "sections/lm-cart-chat.liquid");
    assert.match(source, /cart\.original_total_price \| money/);
    assert.match(source, /data-currency="{{ cart\.currency\.iso_code/);
    assert.match(source, /rateCurrency === cartCurrency/);
    assert.match(source, /Final total at checkout/);
    assert.match(source, /@media \(max-width:620px\)/);
    assert.match(source, /role="status" aria-live="polite"/);
    assert.match(source, /aria-pressed/);
    assert.match(source, /new AbortController\(\)/);
    assert.match(source, /signal: controller\.signal/);
  });

  test(`${theme}: public agent attribution uses the current brand`, () => {
    for (const relativePath of [
      "sections/lm-home-agent.liquid",
      "sections/lm-search-agent.liquid",
      "sections/lm-collection-agent.liquid",
      "sections/lm-pdp-agent.liquid",
    ]) {
      const source = read(theme, relativePath);
      assert.doesNotMatch(source, /worldproducts_agent|"alternateName": "Landmark"/);
    }
  });

  test(`${theme}: browser traffic and agent-native discovery use separate endpoints`, () => {
    const settings = read(theme, "config/settings_schema.json");
    const drawer = read(theme, "assets/wp-agent-drawer.js");
    assert.match(settings, /"id": "wp_governance_api_base"/);
    assert.match(settings, /"id": "wp_agent_core_api_base"/);
    assert.match(settings, /Never point the theme directly at credentialed Agent Core/);
    assert.doesNotMatch(drawer, /authorization|bearer/i);
    for (const relativePath of [
      "sections/lm-home-agent.liquid",
      "sections/lm-search-agent.liquid",
      "sections/lm-collection-agent.liquid",
      "sections/lm-pdp-agent.liquid",
    ]) {
      const source = read(theme, relativePath);
      assert.match(source, /wp_agent_core_api_base/);
      assert.match(source, /\/mcp/);
      assert.doesNotMatch(source, /api\/ucp\/mcp/);
    }
  });

  test(`${theme}: completed sourcing results return directly to the active conversation`, () => {
    const source = read(theme, "assets/wp-workspace.js");
    assert.match(source, /var fallbackResults = conversationTaskResults\(messages\)/);
    assert.match(source, /requestResults\(\)\.slice\(0, limit\)/);
    assert.match(source, /state\.selectedTask && Array\.isArray\(state\.results\)/);
    assert.match(source, /if \(!isGovernanceResultMessage\(state\.messages\[index\]\)\) continue/);
    assert.match(source, /scheduleAutomaticSourcing\(\)/);
    assert.match(source, /await queueDynamicRequest\(query, brief\.language, criteria, brief\.requestKey\)/);
    assert.match(source, /var visibleTasks = state\.conversation \? state\.conversationTasks : state\.tasks/);
    assert.match(source, /Prepared products are shown in this conversation/);
    assert.match(source, /result_preparation_credits_per_product/);
    assert.match(source, /idempotency_key: clientId\("prepare"\)/);
    assert.match(source, /quantity: requestedQuantity/);
    assert.match(source, /available to prepare/);
    assert.doesNotMatch(source, /Prepare up to 3 more products/);
    assert.doesNotMatch(source, /Open the request to review results/);
    assert.doesNotMatch(source, /within 30 minutes/);
    assert.doesNotThrow(() => new Function(source));
  });
}

test("main theme: PDP uses one retail hierarchy and defers shipping work until requested", () => {
  const source = read("shopify-theme", "sections/lm-pdp-chat.liquid");
  const layout = read("shopify-theme", "layout/chat.liquid");
  assert.match(source, /class="wp-pdp-breadcrumbs"/);
  assert.match(source, /<details class="wp-ship-estimator"/);
  assert.match(source, /Secure checkout by Shopify/);
  assert.match(source, /Delivery quote before payment/);
  assert.match(source, /Need a different size, material or budget\?/);
  assert.match(source, /box\.addEventListener\('toggle'/);
  assert.match(source, /if \(!resp\.ok\) throw new Error/);
  assert.doesNotMatch(source, /30-day returns/i);
  assert.doesNotMatch(layout, /wp-service-launchers|wp-account-entry/);
});

test("main theme: cargo checkout blocking keeps an explicit reason", () => {
  const source = read("shopify-theme", "sections/lm-cart-chat.liquid");
  assert.match(source, /function setCheckoutBlocked\(blocked, reason\)/);
  assert.match(source, /Checkout remains paused until shipping eligibility can be verified/);
  assert.match(source, /aria-describedby="CartShippingStatus"/);
});
