# Shopify App Proxy staging wiring

This is a reviewable configuration for a dedicated development store and an
unpublished Liquid theme. No deployment, app installation, production host,
credential, or live acceptance result is included. The operator must supply an
approved staging identity before Live can be verified.

## Request mapping

| Browser request, same storefront origin | BFF path | Agent Core path |
| --- | --- | --- |
| GET /apps/reference-store/api/runtime/status | GET /api/runtime/status | GET /sandbox/status |
| GET /apps/reference-store/api/runtime/doctor | GET /api/runtime/doctor | GET /sandbox/status |
| POST /apps/reference-store/api/runs | POST /api/runs | GET /sandbox/status, then POST /sandbox/api/search/v2 |

Set theme setting `wp_runtime_mode=shopify_read_only` (the default) and
`wp_app_proxy_path=/apps/reference-store`. Use a relative
path in the theme; the Worker origin and all credentials remain server-side.
The App Proxy destination is the Worker root, without an extra `/api` suffix.
Shopify appends the remaining path, preserves the request method and body, and
adds its signed query parameters. See Shopify's
[App Proxy routing](https://shopify.dev/docs/apps/build/online-store/app-proxies)
and [authentication contract](https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies).

The browser sends `{ "query": "desk organizer" }`, with optional `limit` and
opaque `cursor`, to the run endpoint. It sends no mode, upstream URL, token,
customer identifier, or Shopify signature. The Worker validates the proxy HMAC,
configured shop and timestamp; decoded repeated parameters participate in the
signature exactly as Shopify specifies. Proxy query parameters are never
forwarded to Core or reflected in the runtime response.

## Server configuration

Use [the Wrangler template](../storefront-bff/wrangler.staging.example.toml) and
[the Shopify app fragment](../storefront-bff/shopify.app.staging.example.toml) as
review inputs. They contain only example.invalid hosts and no secret values.
The app fragment adds the scope required to configure the proxy; it does not
grant the BFF any product, cart, checkout, order or payment write capability.

Before an authorized staging deployment, the operator must configure:

- An approved dedicated development-store identity in `SHOPIFY_APP_PROXY_SHOP`.
- The exact public storefront origin in `STOREFRONT_ORIGIN` and
  `ALLOWED_ORIGINS`; use the same origin that opens product pages in preview.
- The staging Core origin in `AGENT_CORE_SANDBOX_URL`, with its exact accepted
  candidate from the paired gate. The process must report `shopify_read_only`.
- The staging app shared secret as the server-only `SHOPIFY_APP_PROXY_SECRET`
  binding, and a dedicated `AGENT_CORE_SANDBOX_INVITE` binding for an
  invite-protected Hosted Core. The BFF sends it only as `X-Sandbox-Invite`.
  `AGENT_CORE_SANDBOX_TOKEN` is reserved for literal `127.0.0.1` local
  sandboxes; configuring both credentials fails closed.
- A staging Worker hostname matching the App Proxy destination. The template
  disables workers.dev and preview URLs and contains no production route.

The Core process owns any Shopify read credential. Never copy it into theme
settings, Liquid, the BFF example files, screenshots, browser storage, or QA
receipts. Keep the legacy tenant credential unset for this staging process.

Before deploying, create the canonical closed `BFF_DEPLOYMENT_DESCRIPTOR` from
the exact frozen Reference Store tree/commit/version, BFF commit/version, and
accepted Core commit/version. Sign those exact UTF-8 bytes with the release
control plane's Ed25519 key and set `BFF_DEPLOYMENT_DESCRIPTOR_SIGNATURE` plus
its public `BFF_DEPLOYMENT_SIGNING_KEY_ID`. The private key never enters the
Worker. Runtime routes fail before upstream access when this envelope is absent
or malformed. Status, doctor, and every read run return the same closed identity
and attestation for independent signature verification by the acceptance gate.
Do not record proxy query strings: Shopify may add a customer identifier.
The Worker neither uses that identifier nor accesses customer/account data.

Shopify lets merchants customize an installed proxy prefix and subpath.
When that happens, update the theme's prefix to the installed value; the BFF
destination stays the same. This implementation verifies the full signature
without treating an untrusted forwarded header as a store identity.

## Runtime and CTA contract

A valid status returns `reference-store-runtime-status/v1`. Read availability
comes from `connected`, `credential_state`, and `capabilities.catalog_search`
plus `capabilities.search_contract_v2`. `shopify_read_only` must never call
legacy `/api/chat`, `/api/search`, or `/api/catalog`, even when deployment
configuration is incomplete. Synthetic fallback is unavailable in that mode.

A valid unconnected status remains visible with its actual credential state.
The doctor returns `ok: false` for an unconnected runtime. A run first checks
status and stops before search when credentials or capability are unavailable.
The customer UI must reserve a connected Live label for a verified Shopify
status and keep purchasing/sourcing writes unavailable: runtime boundaries
always include `commerce_writes: false` and `purchasable: false`.

All BFF response envelopes use `Cache-Control: no-store`. Authentication
failures, mode mismatch, invalid contracts and upstream errors return closed
public error codes; credentials and raw upstream error bodies are not returned.
The configured request quota is local to each Worker isolate and is not a
merchant-wide durable rate limit.

## Acceptance and Live-only blockers

Run the repository's BFF and Liquid preview suites against the final paired
candidate. Mock/injected App Proxy coverage proves routing, body forwarding,
closed errors, server status behavior and credential isolation. It does not
prove a Shopify-installed proxy or a live Storefront API connection.

For live acceptance, use an authenticated dedicated development-store session,
an installed staging app/proxy, a reachable staging BFF and the accepted Core
candidate. Execute ten read-only journeys through the unpublished Liquid
preview; record only query case IDs, response status, sanitized capability
states, result counts, and verification times. Check the status and doctor in
the same session. Confirm the browser contacts only its storefront origin for
runtime APIs, makes no legacy call, and receives no credential.

Use the fail-closed [real App Proxy 10/10 gate](SHOPIFY_APP_PROXY_LIVE_GATE.md)
to seal the preview URL, permanent shop and theme identity, all three component
identities, ten private known cases, browser safety counts, and the sanitized
external receipt. Local injected 10/10 tests are necessary coverage but are
not evidence of an installed App Proxy or a connected Shopify catalog.

If any prerequisite is unavailable, keep the injected results and explicitly
report these Live-only blockers: dedicated development-store identity/session,
installed App Proxy, staging Worker route and bindings, or accepted reachable
Core. Do not substitute an operating store, synthetic results labeled Live,
or production deployment. Actual 10/10 Live journeys remain unverified until
those prerequisites exist.
