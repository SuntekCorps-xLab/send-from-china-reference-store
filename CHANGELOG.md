# Changelog

All notable changes to this project are documented here.

## Unreleased

- Added a tested Shopify Agent BFF starter with a credential-free browser
  adapter and a deployment configuration that keeps Agent Core credentials in
  the server secret store.
- Made CodeQL manually triggerable while preserving the private-repository skip
  and public-repository enforcement boundary.

- Integrated the Storefront BFF with Agent Core Search Contract v2 while
  keeping search semantics in Agent Core and preserving the compact browser
  query as a rule-free convenience wrapper.
- Added executable compatibility coverage for contract statuses, pagination,
  public response allowlisting, authentication isolation, and unsupported or
  malformed upstream contracts.
- Added mock/live integration guidance, a compatibility matrix, and CycloneDX
  SBOM policy and CI generation.
- Distinguished browseable catalog links from verified Shopify purchase
  handoffs in the Storefront BFF.
- Rejected supplier and cross-store URLs from customer commerce responses and
  added hosted-platform integration guidance.
- Reserved `product_url` for verified same-origin purchase evidence, exposed
  derived destinations as browse links, and rejected malformed service origins.
- Added an opt-in cross-repository smoke test for a controlled Agent Core
  deployment and the browser-safe Storefront BFF boundary.
- Replaced the static repository hero with a lightweight animated walkthrough
  of catalog shopping, contextual agent guidance, and Shopify handoff.

## 1.0.0 - 2026-08-24

- Added explicit zero-account Demo versus connected-mode labels and a public
  `/api/status` response.
- Rejected invalid and empty demo chat requests instead of returning default
  recommendations.
- Marked synthetic cards as illustrative and added a visible three-stage demo
  execution trace and capability status.
- Forwarded structured criteria through the BFF so connected Agent Core chat
  applies the same hard-filter contract as MCP search.
- Documented the catalog-estimate, carrier-rate, and confirmed sourcing-proof
  boundaries.
- Declared the first stable hybrid storefront and shopping-agent reference
  contract.
- Added a root `npm run verify` command for the zero-account demo, BFF, theme
  contracts, responsive drawer QA, documentation links, and safety scan.
- Made the Customer Account boundary explicit: order tracking is installable,
  while workspace and ask adapters remain source-only examples requiring a
  merchant API.
- Removed private compatibility markers, production-domain assumptions, and
  provider-specific aliases from the public reference surface.
- Added pinned CodeQL, Dependabot, and public-repository settings guidance.

## 0.3.0-rc.1 - 2026-08-23

- Added a zero-account interactive storefront and Shopping Agent demo.
- Added a tested Cloudflare Worker BFF that keeps Agent Core tenant credentials
  out of browser code while adapting chat, search, and catalog responses.
- Separated the storefront proxy setting from the agent-native `/mcp` endpoint.
- Rebuilt the README around a 60-second quick start, visual product story,
  architecture, setup paths, safety boundaries, FAQ, and customization map.
- Aligned the storefront integration documentation with Agent Core
  `0.4.0-rc.1`.

## 0.2.0-rc.1 - 2026-08-21

- Aligned the documented storefront handoff with the paired guarded synthetic
  sourcing contract.
- Documented terminal catalog miss, confirmation, idempotency, task lifecycle,
  result pagination, account isolation, and non-commerce boundaries.
- Added a regression test for the Workspace sourcing lifecycle and credential
  separation.

## 0.1.0-rc.1 - 2026-08-20

- Added the hybrid catalog and shopping-agent drawer reference experience.
- Added responsive home, search, collection, product, cart, and workspace UI.
- Added Shopify Customer Account workspace and order-tracking extensions.
- Added local browser/contract tests, GitHub Actions, release documentation,
  dependency updates, and a repository safety scan.
