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
