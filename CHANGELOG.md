# Changelog

All notable changes to this project are documented here.

## Unreleased

- Made the Customer Account boundary explicit: order tracking is installable,
  while the workspace and ask adapters are source-only and require an external
  merchant API.
- Removed private compatibility markers, production-domain assumptions, and
  provider-specific status aliases from the public reference surface.
- Expanded the public safety scan and added a pinned public-only CodeQL
  workflow plus repository-settings release checklist.

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
