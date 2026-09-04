const BOUNDARIES = Object.freeze({
  synthetic: true,
  illustrative: true,
  purchasable: false,
  commerce_writes: false,
  shipping_rates: false,
});

const PRODUCTS = Object.freeze([
  Object.freeze({
    public_id: "synthetic_demo_walnut_organizer",
    title: "Walnut desk organizer",
    tag: "Synthetic natural-wood example",
    price: 29,
    currency: "USD",
    emoji: "🪵",
  }),
  Object.freeze({
    public_id: "synthetic_demo_reading_light",
    title: "Compact reading light",
    tag: "Synthetic small-space example",
    price: 34,
    currency: "USD",
    emoji: "💡",
  }),
  Object.freeze({
    public_id: "synthetic_demo_pour_over",
    title: "Ceramic pour-over set",
    tag: "Synthetic gift example",
    price: 42,
    currency: "USD",
    emoji: "☕",
  }),
]);

const RUNTIME_CHECKED_AT = "2026-08-31T00:00:00.000Z";

const RUNTIME_PRODUCTS = Object.freeze([
  Object.freeze({
    public_id: "synthetic_demo_walnut_organizer",
    handle: "walnut-desk-organizer",
    title: "Walnut desk organizer",
    summary: "Synthetic natural-wood example",
    image: "",
    price: Object.freeze({ amount: 29, currency: "USD" }),
  }),
  Object.freeze({
    public_id: "synthetic_demo_reading_light",
    handle: "compact-reading-light",
    title: "Compact reading light",
    summary: "Synthetic small-space example",
    image: "",
    price: Object.freeze({ amount: 34, currency: "USD" }),
  }),
  Object.freeze({
    public_id: "synthetic_demo_pour_over",
    handle: "ceramic-pour-over-set",
    title: "Ceramic pour-over set",
    summary: "Synthetic gift example",
    image: "",
    price: Object.freeze({ amount: 42, currency: "USD" }),
  }),
]);

const SCENARIOS = new Set(["catalog_match", "terminal_miss", "needs_clarification", "degraded"]);

function publicProduct(product) {
  return {
    ...product,
    match_status: "illustrative_only",
    synthetic: true,
    illustrative: true,
    available: false,
    purchasable: false,
    product_url: "",
    add_to_cart_url: "",
    purchase_handoff: null,
    shipping_rates: false,
  };
}

function userQuery(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  return String([...messages].reverse().find((message) => message?.role === "user")?.content || "")
    .trim()
    .slice(0, 300);
}

export function scenarioFor(payload) {
  const requested = String(payload?.scenario || "").trim().toLowerCase();
  if (SCENARIOS.has(requested)) return requested;
  const query = userQuery(payload).toLowerCase();
  if (/terminal|no[ -]?match|titanium curling stone|impossible/.test(query)) return "terminal_miss";
  if (/clarif|not sure|anything|surprise me/.test(query)) return "needs_clarification";
  if (/degrad|outage|unavailable|retry/.test(query)) return "degraded";
  return "catalog_match";
}

export function simulatedStatus() {
  return {
    ok: true,
    mode: "synthetic_demo",
    data_source: "offline_fixtures",
    live_agent_core: false,
    ...BOUNDARIES,
  };
}

export function simulatedRuntimeStatus() {
  return {
    contract: "reference-store-runtime-status/v1",
    source_contract: "shopify-live-sandbox-status/v1",
    mode: "synthetic_local_sandbox",
    connected: true,
    credential_state: "mock_ready",
    data_source: "synthetic_fixture",
    api_version: null,
    quota: {
      limit: 120,
      remaining: 120,
      window_seconds: 60,
      concurrency_limit: 8,
      reset_at: null,
    },
    writes_disabled: true,
    capabilities: {
      doctor: true,
      catalog_search: true,
      search_contract_v2: true,
      product_detail: true,
      storefront_health: false,
    },
    checked_at: RUNTIME_CHECKED_AT,
    error_code: null,
    boundaries: {
      non_transactional: true,
      purchasable: false,
      shipping_rates: false,
      commerce_writes: false,
      credential_exposed: false,
    },
    components: {
      reference_store: { commit: "1".repeat(40), tree: "2".repeat(40), version: "synthetic-fixture" },
      agent_core: { commit: "3".repeat(40), version: "synthetic-fixture" },
      storefront_bff: { commit: "1".repeat(40), version: "synthetic-fixture" },
    },
    deployment_attestation: {
      contract: "reference-store-deployment-attestation/v1",
      algorithm: "Ed25519",
      key_id: "synthetic-local-no-release",
      descriptor_sha256: "4".repeat(64),
      signature: "A".repeat(86),
    },
  };
}

export function simulatedRuntimeDoctor() {
  return {
    contract: "reference-store-runtime-doctor/v1",
    ok: true,
    runtime: simulatedRuntimeStatus(),
    checks: {
      deployment_mode: true,
      agent_core_status: true,
      expected_mode: true,
      credential_isolated: true,
      writes_disabled: true,
    },
  };
}

function runtimeProduct(product) {
  return {
    ...product,
    price: { ...product.price },
    available_for_sale: false,
    product_url: "",
    shopify_verified_at: null,
    synthetic: true,
    non_transactional: true,
    purchasable: false,
    writes: false,
    shipping_rates: false,
  };
}

export function simulatedRun(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const fields = new Set(["query", "limit", "cursor"]);
  if (Object.keys(payload).some((field) => !fields.has(field))) return null;
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query || query.length > 300) return null;
  const limit = payload.limit === undefined ? 3 : payload.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null;
  if (payload.cursor !== undefined && payload.cursor !== null
    && (typeof payload.cursor !== "string" || payload.cursor.length > 1_000)) return null;

  const legacy = simulatedSearch({ q: query });
  const results = legacy.results.length
    ? RUNTIME_PRODUCTS.slice(0, limit).map(runtimeProduct)
    : [];
  return {
    contract: "reference-store-read-run/v1",
    runtime: simulatedRuntimeStatus(),
    search: {
      contract_version: legacy.contract_version,
      trace_id: legacy.trace_id,
      status: legacy.status,
      normalized_intent: legacy.normalized_intent,
      relaxations: legacy.relaxations,
      missing_criteria: legacy.missing_criteria,
      results,
      pagination: {
        limit,
        cursor: payload.cursor ?? null,
        next_cursor: null,
        has_more: false,
      },
      search_scope: legacy.search_scope,
    },
  };
}

export function simulatedChat(payload) {
  const query = userQuery(payload);
  if (!query) return null;
  const scenario = scenarioFor(payload);
  const common = {
    session_id: "synthetic_demo_session",
    scenario,
    mode: "synthetic_demo",
    data_source: "offline_fixtures",
    live_agent_core: false,
    boundaries: { ...BOUNDARIES },
  };

  if (scenario === "terminal_miss") {
    return {
      ...common,
      status: "no_match",
      reply: `The offline fixture recorded “${query}”. This scenario illustrates a bounded terminal miss; no external sourcing task was created.`,
      results: [],
      dynamic_request_recommended: true,
      next_actions: [{ label: "Preview sourcing confirmation", operation: "preview_only" }],
      search_scope: {
        plan_complete: true,
        scope_exhausted: true,
        global_catalog_exhaustive: false,
        scan_limit_reached: false,
        degraded: false,
      },
      trace: [
        { label: "Synthetic request received", state: "complete" },
        { label: "Fixture scope exhausted", state: "complete" },
        { label: "No write performed", state: "complete" },
      ],
    };
  }

  if (scenario === "needs_clarification") {
    return {
      ...common,
      status: "needs_clarification",
      reply: `The offline fixture recorded “${query}”. Add a budget or use case to preview a more specific result state.`,
      results: [],
      missing_criteria: ["budget", "use_case"],
      dynamic_request_recommended: false,
      trace: [
        { label: "Synthetic request received", state: "complete" },
        { label: "Clarification requested", state: "complete" },
        { label: "No write performed", state: "complete" },
      ],
    };
  }

  if (scenario === "degraded") {
    return {
      ...common,
      status: "degraded",
      reply: "This deterministic fixture demonstrates a retryable service state. It is not a catalog miss and no sourcing action is offered.",
      results: [],
      dynamic_request_recommended: false,
      search_scope: {
        plan_complete: false,
        scope_exhausted: false,
        global_catalog_exhaustive: false,
        scan_limit_reached: false,
        degraded: true,
        degraded_reason: "Synthetic unavailable-service scenario.",
      },
      trace: [
        { label: "Synthetic request received", state: "complete" },
        { label: "Degraded state rendered", state: "complete" },
        { label: "Retry remains available", state: "complete" },
      ],
    };
  }

  return {
    ...common,
    status: "results",
    reply: `The offline fixture recorded “${query}”. These cards demonstrate the governed result UI; they were not evaluated as real catalog matches.`,
    results: PRODUCTS.map(publicProduct),
    dynamic_request_recommended: false,
    trace: [
      { label: "Synthetic request received", state: "complete" },
      { label: "Demo boundary applied", state: "complete" },
      { label: "Illustrative cards rendered", state: "complete" },
    ],
  };
}

export function simulatedSearch(payload) {
  const query = String(payload?.q || payload?.search_contract?.product_identity?.value || "").trim().slice(0, 300);
  if (!query) return null;
  const scenario = scenarioFor({ ...payload, messages: [{ role: "user", content: query }] });
  const terminal = scenario === "terminal_miss";
  const degraded = scenario === "degraded";
  const clarification = scenario === "needs_clarification";
  return {
    contract_version: "2.0",
    trace_id: `trace_synthetic_${scenario}`,
    status: terminal ? "no_match" : degraded ? "degraded" : clarification ? "needs_clarification" : "results",
    normalized_intent: {
      product_identity: {
        name: "product_identity",
        value: query,
        source: "explicit",
        scope: "product",
        hardness: "hard",
      },
      hard_constraints: [],
      soft_context: [],
      transaction_context: [],
    },
    relaxations: [],
    missing_criteria: clarification ? ["budget", "use_case"] : [],
    results: terminal || degraded || clarification ? [] : PRODUCTS.map(publicProduct),
    pagination: { limit: 3, cursor: null, next_cursor: null, has_more: false },
    search_scope: {
      plan_complete: terminal,
      scope_exhausted: terminal,
      global_catalog_exhaustive: false,
      scan_limit_reached: false,
      degraded,
      degraded_reason: degraded ? "Synthetic unavailable-service scenario." : null,
    },
    mode: "synthetic_demo",
    data_source: "offline_fixtures",
    boundaries: { ...BOUNDARIES },
  };
}
