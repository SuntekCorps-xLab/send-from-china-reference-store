# Public Roadmap

This roadmap covers the open reference storefront. It is directional and does
not promise access to a hosted merchant, Agent Core tenant, shipping provider,
or production Shopify store.

## Available in 1.0

- A zero-account shopping-agent demo with catalog-match, terminal-miss,
  clarification, and degraded synthetic scenarios.
- A sanitized browser contract inspector with explicit illustrative,
  non-purchasable, no-shipping, and no-write labels.
- A paired local launcher for the Reference Store BFF and Agent Core synthetic
  sandbox; the local token remains server-side.
- A browser-safe BFF that keeps Agent Core tenant credentials server-side.
- Shopify theme patterns for catalog-first search, contextual assistance,
  explicit sourcing confirmation, cart handoff, and truthful failure states.
- An installable Customer Account order-tracking extension.
- Contract, browser, accessibility, and repository-safety checks.

## Next

- Copyable fixtures for partial data, quota, and expired-state journeys.
- More accessible keyboard, screen-reader, reduced-motion, and responsive
  acceptance examples.
- A small integration gallery showing merchant-owned adapter boundaries.
- A deployment checklist for development stores and preview Workers.

## Exploring

- A one-click preview deployment that remains synthetic by default.
- A hosted self-service sandbox with short-lived scoped credentials, tenant
  isolation, quotas, revocation, abuse monitoring, and audit logs.
- A synthetic evaluation pack for truth labels and customer state transitions.
- Additional storefront framework adapters built against the same BFF contract.

## Deliberately out of scope

The repository will not ship production merchant credentials, customer data,
real carrier quotes, supplier access, checkout completion, payment processing,
or automatic ordering. Shopify or a separately operated merchant service must
remain the source of truth for commerce writes and customer state.

Use a feature-request issue to propose an item. Maintainers will label accepted
work with `help wanted` or `good first issue` after defining its source of truth,
failure state, and acceptance tests.
