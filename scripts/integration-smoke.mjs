import assert from "node:assert/strict";
import worker from "../storefront-bff/src/index.js";

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function serviceBase(value) {
  const url = new URL(value);
  const local = url.hostname === "localhost"
    || url.hostname === "[::1]"
    || url.hostname === ["127", "0", "0", "1"].join(".");
  assert.ok(url.protocol === "https:" || (local && url.protocol === "http:"),
    "AGENT_CORE_BASE_URL must use HTTPS, except for localhost");
  assert.equal(Boolean(url.username || url.password || url.search || url.hash), false,
    "AGENT_CORE_BASE_URL must not contain credentials, a query, or a fragment");
  return url.href.replace(/\/+$/, "");
}

function exactStorefrontOrigin(value) {
  const url = new URL(value);
  assert.equal(url.protocol, "https:", "STOREFRONT_ORIGIN must use HTTPS");
  assert.equal(Boolean(url.username || url.password || url.search || url.hash), false,
    "STOREFRONT_ORIGIN must not contain credentials, a query, or a fragment");
  assert.equal(url.pathname, "/", "STOREFRONT_ORIGIN must not contain a path");
  return url.origin;
}

async function payload(response, label) {
  assert.equal(response.ok, true, `${label} returned HTTP ${response.status}`);
  return response.json();
}

const baseUrl = serviceBase(required("AGENT_CORE_BASE_URL"));
const tenantKey = required("AGENT_CORE_TENANT_KEY");
const storefrontOrigin = exactStorefrontOrigin(
  String(process.env.STOREFRONT_ORIGIN || "https://store.example.test").trim(),
);
const env = {
  AGENT_CORE_BASE_URL: baseUrl,
  AGENT_CORE_TENANT_KEY: tenantKey,
  STOREFRONT_ORIGIN: storefrontOrigin,
  ALLOWED_ORIGINS: storefrontOrigin,
};

const discoveryResponse = await fetch(`${baseUrl}/.well-known/send-from-china.json`, {
  headers: { accept: "application/json" },
});
const discovery = await payload(discoveryResponse, "capability discovery");
assert.equal(discovery.service, "send-from-china-agent-core");
assert.equal(discovery.capabilities?.catalog_search, true);
assert.equal(discovery.capabilities?.search_contract_v2, true);

const chatResponse = await worker.fetch(new Request("https://bff.example.test/api/chat", {
  method: "POST",
  headers: { origin: storefrontOrigin, "content-type": "application/json" },
  body: JSON.stringify({
    session_id: "integration_smoke_session",
    messages: [{ role: "user", content: "desk organizer" }],
    criteria: { category: "Office", price_max: 15, ship_to: "US" },
  }),
}), env);
const chat = await payload(chatResponse, "BFF chat");
assert.deepEqual(chat.results, []);
assert.equal(chat.dynamic_request_recommended, true);
assert.equal(chat.live_agent_core, true);
assert.ok(chat.criteria_evaluation?.enforced?.includes("category"));
assert.ok(chat.criteria_evaluation?.enforced?.includes("price_max"));
assert.ok(chat.criteria_evaluation?.informational?.includes("ship_to"));
assert.equal(JSON.stringify(chat).includes(tenantKey), false, "tenant key leaked into the browser response");

const searchResponse = await worker.fetch(new Request("https://bff.example.test/api/search", {
  method: "POST",
  headers: { origin: storefrontOrigin, "content-type": "application/json" },
  body: JSON.stringify({
    search_contract: {
      contract_version: "2.0",
      product_identity: {
        name: "product_identity", value: "desk", source: "explicit", scope: "product", hardness: "hard",
      },
      hard_constraints: [],
      soft_context: [{
        name: "recipient", value: "coworker", source: "explicit", scope: "session", hardness: "soft",
      }],
      transaction_context: [],
      limit: 1,
      cursor: null,
    },
  }),
}), env);
const search = await payload(searchResponse, "BFF search");
assert.equal(search.contract_version, "2.0");
assert.equal(search.status, "results");
assert.equal(search.normalized_intent.product_identity.value, "desk");
assert.equal(search.pagination.limit, 1);
assert.equal(search.results.length, 1, "the sample Agent Core should return one desk result");
const product = search.results[0];
assert.ok(product.browse_url.startsWith(`${storefrontOrigin}/products/`));
assert.equal(product.product_url, "", "a derived browse URL must not become purchase evidence");
assert.equal(product.available, false);
assert.equal(product.purchase_handoff, null);
assert.equal(JSON.stringify(search).includes(tenantKey), false, "tenant key leaked into the browser response");

const missResponse = await worker.fetch(new Request("https://bff.example.test/api/search", {
  method: "POST",
  headers: { origin: storefrontOrigin, "content-type": "application/json" },
  body: JSON.stringify({ q: "quartz violin umbrella", limit: 5 }),
}), env);
const miss = await payload(missResponse, "BFF terminal miss");
assert.equal(miss.contract_version, "2.0");
assert.equal(miss.status, "no_match");
assert.deepEqual(miss.results, []);
assert.equal(miss.search_scope.plan_complete, true);
assert.equal(miss.search_scope.scope_exhausted, true);
assert.equal(miss.search_scope.degraded, false);

console.log(JSON.stringify({
  ok: true,
  service: discovery.service,
  version: discovery.version,
  verified: [
    "public capability discovery",
    "Search Contract v2 capability and response",
    "server-side tenant authentication",
    "four-part search intent forwarding",
    "terminal catalog miss",
    "truthful pagination and retrieval scope",
    "browse and purchase-link separation",
    "browser response credential isolation",
  ],
}, null, 2));
