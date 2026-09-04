# Storefront BFF 🔐

A deliberately small browser-to-Agent Core adapter for the reference Shopify
storefront. It keeps the tenant credential server-side and exposes only the
response fields used by catalog, search, and Shopping Agent UI.

## Local setup

```bash
cp .dev.vars.example .dev.vars
npm ci
npm test
npm run dev
```

Configure:

| Binding | Secret | Purpose |
| --- | --- | --- |
| `AGENT_CORE_BASE_URL` | No | Agent Core origin, without a trailing slash |
| `AGENT_CORE_TENANT_KEY` | **Yes** | Tenant Bearer key; use `wrangler secret put` |
| `AGENT_CORE_PAGE_SIZE` | No | Requested page ceiling from `1` to `50`; defaults to `20` and Agent Core may reduce it to the tenant policy |
| `STOREFRONT_ORIGIN` | No | Allowlisted merchant origin and browse-link base |
| `ALLOWED_ORIGINS` | No | Exact comma-separated browser origins |

The legacy routes above remain available for the existing reference UI. The
runtime routes use a separate, explicit sandbox boundary:

| Binding | Secret | Purpose |
| --- | --- | --- |
| `AGENT_CORE_SANDBOX_URL` | No | Exact Agent Core Sandbox origin; the BFF appends only `/sandbox/status` or `/sandbox/api/search/v2` |
| `AGENT_CORE_SANDBOX_INVITE` | **Yes, optional** | Server-side invite sent only as `X-Sandbox-Invite` to a public-DNS HTTPS Hosted Sandbox |
| `AGENT_CORE_SANDBOX_TOKEN` | **Yes, optional** | Server-side Bearer token sent only to a literal `127.0.0.1` Sandbox |
| `BFF_RUNTIME_MODE` | No | Required expected mode: `synthetic_local_sandbox` or `shopify_read_only` |
| `BFF_DEPLOYMENT_MODE` | No | Required ingress mode: `local` or `shopify_app_proxy` |
| `STOREFRONT_ORIGIN` | No | Exact public-DNS HTTPS Shopify storefront origin used to verify live product links |
| `ALLOWED_ORIGINS` | No | Exact browser origins; required for `shopify_app_proxy` and never inferred from request input |
| `BFF_UPSTREAM_TIMEOUT_MS` | No | Upstream timeout from 100 to 30000 milliseconds; defaults to 5000 |
| `BFF_QUOTA_LIMIT` | No | Per-isolate in-memory request limit; defaults to 120 |
| `BFF_QUOTA_WINDOW_SECONDS` | No | In-memory quota window; defaults to 60 seconds |
| `BFF_CONCURRENCY_LIMIT` | No | Per-isolate in-memory concurrency limit; defaults to 8 |

`local` accepts runtime requests only when the request URL host is exactly
`127.0.0.1`. It is intended for the local demo server, which is responsible for
binding its listener to the same address. `shopify_app_proxy` additionally
requires `SHOPIFY_APP_PROXY_SECRET` and `SHOPIFY_APP_PROXY_SHOP`; every runtime
request must carry a valid Shopify App Proxy HMAC and a timestamp inside the
configured window (`SHOPIFY_APP_PROXY_TIMESTAMP_WINDOW_SECONDS`, 300 seconds by
default). In either configured deployment mode the same ingress check and quota
also guard the retained legacy `/api/*` routes; Shopify read-only runtime mode
disables those legacy routes so only the closed runtime API is available.
`/health` remains public.

Credentials are server-only. They must not be placed in Liquid, theme settings,
URLs, query strings, browser storage, requests to these routes, or response
bodies. Configure at most one Sandbox credential. A Hosted HTTPS origin with a
Bearer token, a loopback origin with an invite, or both credentials configured
fails closed before any upstream request. The runtime mode also comes only from `BFF_RUNTIME_MODE`; browser input
cannot switch a synthetic process to Shopify.

See the [staging App Proxy wiring guide](../docs/SHOPIFY_APP_PROXY_STAGING.md)
for the same-origin Liquid prefix, Worker routing, and credential-free examples.
After staging is installed, use the separate
[real App Proxy 10/10 gate](../docs/SHOPIFY_APP_PROXY_LIVE_GATE.md). The normal
paired smoke is injected coverage and must not be represented as that Live
acceptance result.

## Routes

- `GET /health`
- `POST /api/chat`
- `POST /api/search`
- `POST /api/catalog`
- `GET /api/runtime/status`
- `GET /api/runtime/doctor`
- `POST /api/runs`

`GET /api/runtime/status` strictly validates the Agent Core
`shopify-live-sandbox-status/v1` response and returns the smaller closed
`reference-store-runtime-status/v1` projection. A valid unverified Shopify
status remains visible as `connected: false`; it is never relabeled or replaced
with synthetic data. `GET /api/runtime/doctor` returns the same projection with
closed server-side deployment, connection, mode, credential-isolation, and
write-boundary checks.

`POST /api/runs` accepts `{ "query": "..." }` (with optional `limit` and opaque
`cursor`). It obtains status first and performs search only when that exact
runtime is verified. Its `reference-store-read-run/v1` response contains the
same frozen runtime projection and a validated Search Contract v2 public
response. Product results expose only public identity, title/summary/image,
verified price and availability, the normalized product URL, verification time,
and explicit non-transactional boundaries. They never contain cart, checkout,
order, payment, inventory, or shipping-rate claims.

Live product links are accepted only when they are exact, public-DNS HTTPS URLs
on `STOREFRONT_ORIGIN` with the path `/products/<matching-handle>`. Userinfo,
ports, query strings, fragments, IP literals, private hostnames, cross-store
origins, and non-product paths fail the complete run closed.

The Worker rejects unknown origins, malformed or oversized requests, and missing
configuration. It never returns the tenant key, upstream response bodies, or a
server stack. Every success, error, health response, and preflight is
`Cache-Control: no-store`; no business cookie, query/response persistence, or
telemetry is used. Upstream redirects, non-JSON responses, oversized streams,
timeouts, and quota exhaustion map to stable public error codes without passing
through upstream bodies. See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the
browser contract and trust boundaries.

The runtime error enum is:
`app_proxy_authentication_failed`, `app_proxy_timestamp_expired`,
`authentication_failed`, `credential_missing`, `deployment_not_configured`,
`invalid_request`, `invalid_shopify_product_url`,
`invalid_upstream_content_type`, `invalid_upstream_contract`,
`local_binding_required`, `not_found`, `origin_not_allowed`, `permission_required`, `quota_exceeded`,
`request_too_large`, `runtime_mode_mismatch`, `runtime_not_configured`,
`service_unavailable`, `upstream_contract_unavailable`,
`upstream_redirect_rejected`, `upstream_response_too_large`, and
`upstream_timeout`. Runtime failures use the closed envelope
`{ error, expected_mode, runtime? }`; `runtime` is included only after a valid
S1 status projection exists.

`POST /api/search` consumes Agent Core Search Contract v2. A full
`search_contract` is forwarded to authenticated `POST /api/search/v2`; a
compact `{q, limit, cursor}` request is wrapped only as an explicit product
identity. The BFF does not implement synonyms, filter hardness, relaxation,
ranking, or terminal-miss logic. See the
[mock and live quickstart](../docs/SEARCH_CONTRACT_V2_INTEGRATION.md).

A URL derived from a returned slug is exposed as `url` and `browse_url`, but is
not proof that a Shopify product is purchasable. `product_url` remains empty
unless Agent Core explicitly returns an HTTPS product URL on the configured
`STOREFRONT_ORIGIN`. The BFF sets `available=true` only when that verified URL
is accompanied by `purchasable=true`. Supplier and cross-store URLs are
discarded. `STOREFRONT_ORIGIN` must be an exact HTTPS origin without a path,
credentials, query, or fragment.

This is a reference adapter, not a customer identity service. Authenticated
sourcing writes and saved state belong behind the Customer Account boundary.

Search cursors are opaque. Repeat the same contract with `next_cursor` and do
not infer totals. `degraded` is a retryable service state, never a catalog miss.
