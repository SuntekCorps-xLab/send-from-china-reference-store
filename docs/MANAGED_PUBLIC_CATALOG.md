# Managed public catalog profile

`managed_public_catalog` is an independent, server-selected BFF profile for a
public catalog cohort. It does not extend or reinterpret Agent Core's
`shopify-live-sandbox-status/v1` contract and it cannot be selected by browser
input. The existing synthetic and Shopify read-only profiles keep their current
routes and behavior.

## Trust boundary

The browser calls only same-origin BFF routes. The BFF invokes an injected
managed-catalog MCP adapter; there is deliberately no generic browser-controlled
proxy or default network implementation. The exact upstream `/mcp` endpoint and
its exact HTTPS origin are independent server configuration:

| Binding | Purpose |
| --- | --- |
| `BFF_RUNTIME_MODE=managed_public_catalog` | Selects this profile at process configuration time |
| `MANAGED_CATALOG_ENABLED=true` | Explicitly enables the profile |
| `MANAGED_CATALOG_ENDPOINT` | Exact public-DNS HTTPS URL whose path is `/mcp` |
| `MANAGED_CATALOG_ALLOWED_ORIGIN` | Exact origin that must match the endpoint |
| `STOREFRONT_ORIGIN` | Exact public-DNS HTTPS storefront origin for canonical PDP links |
| `MANAGED_CATALOG_IMAGE_ORIGINS` | Optional comma-separated exact HTTPS image origins; storefront origin is always allowed |
| `MANAGED_CATALOG_ADAPTER` | Optional injected MCP `initialize`, `listTools`, and `callTool` transport for tests or platform bindings |
| `MANAGED_CATALOG_FETCH` | Optional anonymous platform service binding; otherwise the Worker uses its built-in anonymous HTTPS transport |
| `MANAGED_CATALOG_COHORT_PROVIDER` | Server-injected accepted cohort provider |
| `BFF_UPSTREAM_TIMEOUT_MS` | Adapter timeout from 100–30000 ms; defaults to 5000 |
| `SOURCE_HANDOFF_TIMEOUT_MS` | Receiver timeout from 100–5000 ms; defaults to 1000 |

No production hostname or credential is stored in this repository. The built-in
transport sends no authorization or cookie, performs no retry, and rejects
redirects. A platform may inject an anonymous service binding but cannot inject
a browser credential. Credentials are never
accepted from Liquid, theme settings, URL/query parameters, local storage, or
request bodies, and are never projected into a response.

All routes inherit the BFF ingress boundary: local mode accepts only literal
`127.0.0.1`; App Proxy mode requires a valid Shopify HMAC and timestamp window.
Responses and errors are `Cache-Control: no-store`. Existing body, concurrency,
quota, same-origin, and public-error handling applies. Adapter reads have a
5-second default timeout (bounded by `BFF_UPSTREAM_TIMEOUT_MS` from 100–30000 ms),
receive an abort signal, and cannot return more than 256 KiB. The source receiver
defaults to a 1-second timeout and is bounded to 100–5000 ms by
`SOURCE_HANDOFF_TIMEOUT_MS`.

Discovery requires MCP protocol `2025-06-18` and `world-products` `1.0.0`.
The BFF freezes its catalog-read allowlist to `product_search`,
`search_catalog`, `browse_catalog`, `ask_catalog`, and `get_product`. Additional
advertised sourcing or write tools do not invalidate discovery, but this profile
never exposes or invokes them. Runtime calls use only `product_search` and
`get_product`; `search`, `confirm_search`, and `more` are all read-only search
operations and `mode` remains server-selected as `catalog`.

MCP responses are stream-counted before JSON parsing. Detail handles must match
the requested handle exactly. Consumed scalar request and response fields must
already have their declared JSON type; arrays, booleans, and objects are never
string-coerced. Numeric catalog prices remain numbers; strings,
booleans, infinities, negatives, and contradictory dual price fields fail
closed, while absent or null prices project as explicit `catalog_price: null`.
Terminal `no_match` requires an empty page, no cursor, no scan cap or degraded
state, and explicit bounded-plan and scope-exhaustion proof.
The initialized notification accepts only an empty 200/202/204 response and
immediately cancels any unexpected body.

## Closed routes

- `GET /api/managed-catalog/curated` loads only an accepted, unexpired cohort of
  20–50 unique handles, then refreshes each product through the adapter with at
  most four concurrent detail reads. Missing, pending, expired, malformed, or
  unreachable cohort state returns `curated_not_ready`; it never becomes a
  synthetic or broader-catalog result.
- `POST /api/managed-catalog/search` accepts `query`, `scope`, optional `limit`
  (maximum 5), and opaque `cursor`. `broader_public_catalog` requires
  `explicit_broader_search: true` and every result is labelled
  `broader_public_catalog_unreviewed`, never curated or quality-approved.
- `POST /api/managed-catalog/product` refreshes one handle before returning the
  MCP catalog price, catalog availability, purchase-verification state, and the
  requirement to verify commerce again at the storefront boundary.

Product URLs are usable only when they are the exact canonical
`https://<configured-store>/products/<matching-handle>` URL. Active schemes,
userinfo, explicit ports, query strings, fragments, IP/private hosts,
cross-store origins, nested product paths, and handle mismatches fail closed.
The response never promotes catalog availability to Shopify
`availableForSale`, never invents a verification timestamp, ignores MCP
`add_to_cart_url`, and makes no inventory, shipping, sourcing, or transaction
promise. It always states `writes_disabled: true`,
`commerce_verification_required: true`, and `checkout_created: false`.

## Source handoff

`POST /api/source-handoff` accepts a strict canonical product URL, source class,
consent state, and optional opaque source token. The receiver is injected and
disabled by default. Denied or unknown consent returns `privacy_no_tracking`
without calling it. Invalid, expired, disabled, or unavailable token validation
never blocks the storefront purchase path, but it also never records or claims
strong attribution.

The BFF does not create carts or checkouts and does not maintain an attribution
ledger. The receiving Revenue boundary owns token validation and durable
first-valid-cart-source semantics; `already_attributed` is consumed as a closed
receiver result and cannot be overwritten here. Core final pinning remains
dependent on the S0 contract decision.

Response schemas are
[`reference-store-managed-catalog-status.v1.schema.json`](../contracts/reference-store-managed-catalog-status.v1.schema.json)
and
[`reference-store-source-handoff.v1.schema.json`](../contracts/reference-store-source-handoff.v1.schema.json).
