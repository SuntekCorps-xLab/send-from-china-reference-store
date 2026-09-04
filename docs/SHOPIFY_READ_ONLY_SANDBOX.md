# Shopify development-store read-only sandbox

The Reference Store has two explicit runtime modes. `npm run demo:platform`
remains a pure synthetic Agent Core sandbox. `npm run demo:shopify` starts the
separate Shopify development-store read-only path. A mode is selected only by
server startup configuration; browser input, Liquid, theme settings, URLs,
query strings, and browser storage cannot select Shopify mode or carry a
credential.

## Trust path

```text
Browser
  -> this repository's demo/BFF (closed public responses)
  -> Agent Core Sandbox (search truth)
  -> Shopify Storefront API (published product, price, availableForSale,
     and online product URL truth)
```

The browser calls only same-origin BFF endpoints. `GET /api/runtime/status`
projects the strict Agent Core `shopify-live-sandbox-status/v1` response.
`GET /api/runtime/doctor` repeats that check server-side and reports only
closed deployment, mode, connection, credential-isolation, and write-boundary
booleans. `POST /api/runs` returns one
`reference-store-read-run/v1` object. The Workbench, desktop drawer, mobile
sheet, and Runs receipt consume that same recursively frozen browser object;
they do not reconstruct search facts.

The S1 dependency is:

- Agent Core commit: `ca07d540c7535ea7b9e84164b02f4d48caa11853`
- status contract: `shopify-live-sandbox-status/v1`
- Storefront API version asserted by that contract: `2026-07`
- schema file: `contracts/shopify-live-sandbox-status.v1.schema.json`
- schema SHA-256: `30b38d767874351e7c56976a9b707cb1aa6c6764940cd7d338338cb1d01c7211`

## Start commands

Synthetic remains the default paired path:

```bash
npm run demo:platform
```

For a separately authorized Shopify development store, place Shopify and
storefront-origin configuration only in the Agent Core/BFF server environment
or secret provider, then run:

```bash
npm run demo:shopify
```

The launcher finds `sandbox/shopify-server.mjs` in the S1 Agent Core checkout.
Use `--agent-core <directory>` or the server-only `AGENT_CORE_DIR` variable to
select a different checkout. It binds both local listeners to literal
`127.0.0.1`, verifies S1 status before opening the UI, and stops without a
synthetic fallback for credential missing, authentication, permission, quota,
or service-unavailable states. It never prints a Shopify or sandbox token.

The page's Settings / Connections panel is status-only. It has no token input.

## Closed product and URL boundary

A live result can expose only public identity, title, summary/image, Shopify
verified price, `availableForSale`, verification time, and a normalized product
URL. Every result also states: non-transactional, not purchasable here, writes
disabled, and no shipping-rate claim. The runtime has no cart, checkout, order,
payment, inventory, publication, or product-mutation capability.

“Open verified Shopify product” appears only for a public-DNS HTTPS URL on the
configured storefront origin with the exact `/products/<matching-handle>`
path. The complete run fails closed for userinfo, explicit ports, query or
fragment state, JavaScript/data schemes, IP or private hosts, cross-store
origins, and mismatched handles. A URL does not become an inventory,
fulfillment, delivery, or shipping-rate promise.

## Ingress and data handling

Local deployment accepts BFF API traffic only on literal `127.0.0.1`. Shopify
App Proxy deployment requires a configured shop, a server-held secret, an
exact allowlisted browser origin, a valid request HMAC, and a fresh timestamp.
The proxy prefix is retained by same-origin browser requests without encoding
the runtime mode in the URL.

All API, error, health, preflight, and static demo responses use
`Cache-Control: no-store`. Requests and upstream responses have byte limits;
upstream calls have timeouts and reject redirects; isolate-local quota and
concurrency limits use stable operator configuration rather than a transient
Worker environment object. Public errors are enumerated and never pass through
an upstream body or arbitrary header. The demo creates no business cookie,
query/response persistence, local/session storage, IndexedDB data, service
worker, or telemetry.

## Offline verification

The automated suites use fixtures and local HTTP mocks only:

```bash
node --test storefront-bff/test/*.test.mjs demo/tests/*.test.mjs
npm run qa:shopify:chromium
npm run qa:shopify
```

`qa:shopify` is the hard gate for Playwright Chromium, Firefox, and WebKit at
1440×1000 and 390×844. Each case requires zero horizontal overflow, console or
page errors, non-allowlisted requests, and axe serious/critical violations; it
also verifies reduced motion, empty cookies/storage, and exact equality between
the captured BFF response and Runs receipt. Browser engines must already be
installed in the QA environment; the command does not download them or access
Shopify.

## Liquid theme integration and staging boundary

The candidate Liquid theme uses the same three browser routes through its
configured same-origin App Proxy prefix, by default `/apps/reference-store`.
Server status controls the Live, Agent, and sourcing actions. While status is
loading, missing, invalid, disconnected, or reports missing credentials, the
corresponding action stays unavailable. The `shopify_read_only` path does not
call legacy `/api/chat`, `/api/search`, or `/api/catalog`, and a failed read
does not create a synthetic run.

Follow the [staging App Proxy guide](SHOPIFY_APP_PROXY_STAGING.md) and use only
the non-deployable `example.invalid` staging examples checked into
`storefront-bff/`. Provision a protected staging BFF, Shopify App Proxy
registration, and all real secret bindings through the authorized operator.
Keep the Core endpoint, Core tenant/bearer key, App Proxy signing secret, and
Shopify Storefront credential on the server. No production deployment, published
theme, operating-store mutation, or browser credential is part of this candidate.

A local Liquid render with signed proxy simulation and injected Core responses
validates the integration paths, response projection, and browser behavior. It
does not establish an authenticated Shopify unpublished-theme preview or a live
development-store connection. Record those two missing dependencies explicitly
when only injected coverage is available.

## Live-only acceptance blockers

Ten real read-only App Proxy -> Core journeys require all of the following:
a protected staging endpoint, a configured and authenticated App Proxy, an
unpublished theme preview session, and the separately authorized dedicated
Shopify development-store identity with server-provisioned read credentials.
Only enumerate readiness states in evidence; never capture tokens, merchant
responses, customer data, or private hosts.

Without those dependencies, complete the local mock/injected suite and label
its receipts accordingly. Do not substitute the operating store, mark Live as
connected, count mocks as ten live journeys, or claim the internal-preview
release gate has passed.
