# Hosted Platform integration

This reference storefront can sit in front of the self-hosted Agent Core or a
compatible hosted Send From China deployment. The browser must always call the
Storefront BFF; the Agent Core token must remain in a server secret store.

For server-side agent workflows, use the JavaScript SDK in the paired
[`send-from-china-agent-core`](https://github.com/SuntekCorps-xLab/send-from-china-agent-core/tree/main/sdk)
repository. It provides capability discovery, catalog search, sourcing task
polling, pagination, and allowlisted merchant purchase handoffs.

For browser-facing discovery, send Search Contract v2 through the Storefront
BFF. Keep product identity, explicit hard constraints, soft context, and
transaction context separate. The Reference Store does not duplicate Agent
Core's search rules or its v1 compatibility adapter. Follow the
[Search Contract v2 integration guide](SEARCH_CONTRACT_V2_INTEGRATION.md).

## Product-pool expansion

Use the published catalog first. When a bounded search ends in a truthful
terminal miss and the customer explicitly confirms an additional search, a
hosted deployment can create a durable sourcing task. Store the returned task
ID with the customer's saved request and resume polling that task; do not create
a replacement task every time the page is opened.

Only products that complete governance and publication belong in the buyer's
ready-to-buy result set. Candidate and supplier records remain server-side.
Contributor onboarding, identity, ownership, compliance review,
deduplication, and publication approval belong in the managed platform, not in
the Shopify theme or this BFF.

## Shopify remains transaction truth

Agent Core can identify products, but Shopify owns the purchasable product and
variant at the moment the buyer acts. The BFF therefore distinguishes:

- a **browse URL**, which may be derived from a public slug; and
- a **verified purchase handoff**, which requires an explicit HTTPS product
  URL on the configured `STOREFRONT_ORIGIN` plus `purchasable=true`.

In the BFF response, `url` and `browse_url` may contain the derived browsing
destination. `product_url` is reserved for the verified same-origin value and
remains empty when no purchase evidence was supplied.

A derived `/products/<slug>` link is not enough to mark a card available. A
supplier URL, another storefront, or a plain source URL is discarded. The
Shopify product page must re-check variant, inventory, price, delivery, tax,
and cart state before checkout.

## Recommended server flow

1. Discover capabilities and access without exposing the token to the browser.
2. Search the tenant catalog and render governed public records.
3. Ask for explicit customer confirmation only after a terminal miss.
4. Create one idempotent sourcing task and persist its task ID.
5. Poll to a terminal state and page through published results.
6. Accept only allowlisted customer-facing product URLs.
7. Send the customer to Shopify to select a variant and complete checkout.

Do not use product descriptions, model prose, catalog estimates, or supplier
facts as evidence of live Shopify availability.

## Shopify Liquid and same-origin App Proxy

The Shopify read-only integration is locked to Agent Core
`e0fb5743a6ded2cceae18432786bccf946e71752`; see the
[compatibility lock](COMPATIBILITY.md#shopify-read-only-release-lock).
Configure the public App Proxy path in the theme, for example
`/apps/reference-store`. The browser combines that path with these three
routes only:

| Browser request | Purpose |
| --- | --- |
| `GET /api/runtime/status` | Discover server-selected mode, connection, credential state, and capabilities. |
| `GET /api/runtime/doctor` | Check the closed connection and credential-isolation report. |
| `POST /api/runs` | Submit one read-only search contract and receive the public run receipt. |

Shopify forwards signed proxy requests to the merchant BFF. The BFF verifies
the configured shop, fresh timestamp, HMAC, and allowlisted origin before
calling the exact compatible Core. Shopify and Core credentials live only in
server secret bindings. Theme settings, browser storage, query parameters, and
Liquid must never hold them or select a runtime mode.

Live and Agent actions become available only after the server reports a
connected runtime with the matching read capability. A missing credential or
unavailable service is displayed as that state. Sourcing needs its own positive
capability and stays unavailable in the read-only deployment; the generic
sourcing workflow above does not authorize it. An upstream failure never enables
legacy routes or synthetic fallback under a Live label.

The [read-only sandbox guide](SHOPIFY_READ_ONLY_SANDBOX.md) separates local
injected coverage from the protected staging and dedicated development-store
checks still required for a Live release.
