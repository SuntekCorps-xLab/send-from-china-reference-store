(function () {
  "use strict";
  var config = document.currentScript;
  if (window.WPShopifyRuntime || !config) return;
  var mode = config.dataset.runtimeMode || "shopify_read_only";
  if (mode !== "shopify_read_only") return;
  var base = String(config.dataset.proxyPath || "").replace(/\/$/, "");
  // A path only: never send browser requests to a configured upstream host.
  var configured = /^\/(apps|a|community|tools)\/[a-z0-9_-]+$/i.test(base);
  var current = null;
  var pending = null;
  var labels = {
    credential_missing: "Shopify unavailable: credentials are missing.",
    authentication_failed: "Shopify unavailable: authentication failed.",
    permission_required: "Shopify unavailable: permission is required.",
    quota_exceeded: "Shopify unavailable: request limit reached. Try again later.",
    runtime_mode_mismatch: "Shopify unavailable: runtime mode does not match.",
    invalid_upstream_contract: "Shopify unavailable: the server response could not be verified.",
    runtime_not_configured: "Shopify unavailable: App Proxy is not configured.",
    service_unavailable: "Shopify unavailable. Try the connection check again."
  };
  function failure(code) {
    var error = new Error(labels[code] || labels.service_unavailable);
    error.code = Object.hasOwn(labels, code) ? code : "service_unavailable";
    return error;
  }
  function valid(value) {
    return value && value.contract === "reference-store-runtime-status/v1"
      && value.mode === mode && value.data_source === "shopify_storefront_graphql"
      && typeof value.connected === "boolean" && value.writes_disabled === true
      && value.boundaries && value.boundaries.non_transactional === true
      && value.boundaries.purchasable === false && value.boundaries.shipping_rates === false
      && value.boundaries.commerce_writes === false && value.boundaries.credential_exposed === false
      && value.capabilities && typeof value.capabilities.doctor === "boolean"
      && typeof value.capabilities.catalog_search === "boolean"
      && typeof value.capabilities.search_contract_v2 === "boolean"
      && (value.connected ? value.credential_state === "succeeded" : Object.hasOwn(labels, value.credential_state));
  }
  function canSearch() {
    return Boolean(current && current.connected && current.capabilities.catalog_search
      && current.capabilities.search_contract_v2);
  }
  function update(value, error) {
    current = value;
    var ready = canSearch();
    var label = error ? error.message : ready ? "Live Shopify catalog · read only" :
      value ? (labels[value.credential_state] || labels.service_unavailable) : "Checking Shopify connection…";
    document.querySelectorAll("[data-runtime-status]").forEach(function (node) { node.textContent = label; });
    document.querySelectorAll("[data-runtime-agent-label]").forEach(function (node) {
      node.textContent = ready ? "Ask Agent" : "Agent unavailable";
    });
    document.querySelectorAll("[data-open-agent-drawer], [data-finder-mode='agent']").forEach(function (node) {
      node.dataset.runtimeReady = String(ready);
      if (node.matches("[data-finder-mode='agent']")) node.textContent = ready ? "Ask Agent" : "Agent unavailable";
      node.title = label;
      // The drawer remains openable so the customer can inspect/retry the connection.
      node.setAttribute("aria-label", ready ? "Ask Agent" : "Agent unavailable — check connection");
    });
    document.querySelectorAll("[data-runtime-sourcing]").forEach(function (node) {
      node.disabled = true;
      node.setAttribute("aria-disabled", "true");
      node.textContent = "Custom sourcing unavailable in read-only mode";
    });
    window.dispatchEvent(new CustomEvent("wp:runtime-status", { detail: { runtime: value, ready: ready, message: label } }));
    return value;
  }
  async function request(path, body) {
    if (!configured) throw failure("runtime_not_configured");
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 12000);
    try {
      var response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal
      });
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw failure("invalid_upstream_contract");
      var payload = await response.json();
      if (!response.ok) throw failure(payload && payload.error);
      return payload;
    } catch (error) {
      var safe = failure(error.code);
      update(null, safe);
      throw safe;
    } finally { window.clearTimeout(timer); }
  }
  async function status(force) {
    if (pending) return pending;
    if (current && !force) return current;
    pending = (async function () {
      try {
        var value = await request("/api/runtime/status");
        if (!valid(value)) throw failure(value && value.mode !== mode ? "runtime_mode_mismatch" : "invalid_upstream_contract");
        return update(value);
      } catch (error) { update(null, error); throw error; }
      finally { pending = null; }
    })();
    return pending;
  }
  async function doctor() {
    var value = await request("/api/runtime/doctor");
    if (!value || value.contract !== "reference-store-runtime-doctor/v1" || !valid(value.runtime)
      || typeof value.ok !== "boolean") { update(null, failure("invalid_upstream_contract")); throw failure("invalid_upstream_contract"); }
    update(value.runtime);
    return value;
  }
  async function run(query) {
    await status(true);
    if (!canSearch()) throw failure(current && current.credential_state);
    var value = await request("/api/runs", { query: String(query).trim(), limit: 20 });
    if (!value || value.contract !== "reference-store-read-run/v1" || !valid(value.runtime)
      || !value.runtime.connected || !value.search || value.search.contract_version !== "2.0"
      || !["results", "no_match", "needs_clarification", "degraded"].includes(value.search.status)
      || !Array.isArray(value.search.results) || !value.search.results.every(function (p) {
        return p && p.synthetic === false && p.writes === false && p.non_transactional === true
          && p.purchasable === false && p.shipping_rates === false && p.shopify_verified_at
          && productPath(p.product_url, p.handle);
      })) { update(null, failure("invalid_upstream_contract")); throw failure("invalid_upstream_contract"); }
    update(value.runtime);
    return value;
  }
  function productPath(value, handle) {
    try {
      var url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash
        || !/^[a-z0-9-]{1,100}$/.test(handle) || url.pathname !== "/products/" + handle) return "";
      // BFF verifies the configured storefront origin; keep the final navigation same-origin.
      return url.pathname;
    } catch (_) { return ""; }
  }
  window.WPShopifyRuntime = { mode: mode, status: status, doctor: doctor, run: run,
    canSearch: canSearch, productPath: productPath, current: function () { return current; } };
  document.addEventListener("DOMContentLoaded", function () { update(current); status().catch(function () {}); });
})();