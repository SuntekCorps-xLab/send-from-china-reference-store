# Real Shopify App Proxy 10/10 gate

This gate is the only repository check that may claim ten real, read-only
journeys through an installed Shopify App Proxy. It starts in a user-supplied
unpublished theme preview, calls only the same-origin Reference Store proxy,
and writes a sanitized, content-addressed receipt outside the repository.

The normal test suite remains fully offline. `npm run gate:app-proxy-live`
fails before browser launch unless an operator supplies every sealed input and
the exact confirmation value. CI, `npm test`, `npm run verify`, and
`npm run verify:paired` never run this gate implicitly.

## What the two kinds of 10/10 mean

| Result | What it proves | May claim real App Proxy acceptance? |
| --- | --- | --- |
| Injected 10/10 | Local routing, contract validation, negative cases, receipt redaction, and fail-closed behavior using in-process fixtures | No |
| Real App Proxy 10/10 | An HTTPS unpublished Shopify theme preview reached an installed same-origin App Proxy, its staging BFF, and the expected connected read-only Core for ten known products | Yes, for the exact identities and receipt only |

An injected result, a direct Worker URL, a synthetic response, a published
production theme, or a browser request to a cross-origin API cannot satisfy the
real gate.

## Required staging topology

```text
unpublished development-store theme preview
  /apps/reference-store/api/runtime/status
  /apps/reference-store/api/runtime/doctor
  /apps/reference-store/api/runs
                    |
                    v
installed Shopify App Proxy -> dedicated staging BFF -> accepted Hosted Core
```

Before the run, an administrator must provide and independently record:

1. The permanent `*.myshopify.com` development-store domain and unpublished
   theme ID. The preview URL must be HTTPS on that exact permanent domain and
   contain the matching `preview_theme_id`.
2. An installed app whose proxy prefix/subpath is `apps/reference-store` and
   whose destination is the staging BFF root. Review
   [`storefront-bff/shopify.app.staging.example.toml`](../storefront-bff/shopify.app.staging.example.toml).
3. A reachable staging BFF configured from
   [`storefront-bff/wrangler.staging.example.toml`](../storefront-bff/wrangler.staging.example.toml):
   `BFF_RUNTIME_MODE=shopify_read_only`,
   `BFF_DEPLOYMENT_MODE=shopify_app_proxy`, the exact storefront origin, the
   exact permanent shop domain, and the accepted Hosted Core origin.
4. Server-only App Proxy and Core invite bindings. Do not expose those values
   to this harness, the theme, a URL, a cases file, a receipt, or a command
   line. The Core, not the BFF, owns any Shopify read credential.
5. Theme settings `wp_runtime_mode=shopify_read_only` and
   `wp_app_proxy_path=/apps/reference-store` in the unpublished preview.
6. Exact Reference Store commit/tree/version, exact deployed BFF
   commit/version, and exact Agent Core commit/version. The BFF commit must be
   the same Reference Store commit being accepted.
7. A private external cases file conforming to
   [`reference-store-live-app-proxy-cases.v1.schema.json`](../contracts/reference-store-live-app-proxy-cases.v1.schema.json).
   It must contain exactly ten unique case IDs, private known queries, and the
   expected public Shopify handle for each query.

Do not use the operating store, publish a theme, add a write scope, or relax a
failed identity check to make the gate pass.

## Explicit operator command

Use a clean checkout of the exact candidate and Node 22. Set values only in the
current process from an approved control plane. The preview URL and cases file
are private inputs even though the output receipt is redacted.

```powershell
$env:REFERENCE_STORE_LIVE_GATE_CONFIRM = 'READ_ONLY_APP_PROXY_10'
$env:REFERENCE_STORE_LIVE_BROWSER = 'chromium' # repeat for firefox and webkit as separate receipts
$env:REFERENCE_STORE_LIVE_PREVIEW_URL = '<HTTPS unpublished theme preview URL>'
$env:REFERENCE_STORE_EXPECTED_SHOP_DOMAIN = '<permanent-shop-domain.myshopify.com>'
$env:REFERENCE_STORE_EXPECTED_THEME_ID = '<unpublished theme ID>'
$env:REFERENCE_STORE_LIVE_CASES_PATH = '<absolute external path to private cases JSON>'
$env:REFERENCE_STORE_LIVE_EVIDENCE_ROOT = '<new absolute external evidence directory>'
$env:REFERENCE_STORE_EXPECTED_REFERENCE_COMMIT = '<40-character candidate commit>'
$env:REFERENCE_STORE_EXPECTED_REFERENCE_TREE = '<40-character candidate tree>'
$env:REFERENCE_STORE_EXPECTED_REFERENCE_VERSION = '1.1.0'
$env:REFERENCE_STORE_EXPECTED_BFF_COMMIT = '<same candidate commit deployed as BFF>'
$env:REFERENCE_STORE_EXPECTED_BFF_VERSION = '1.1.0'
$env:REFERENCE_STORE_EXPECTED_CORE_COMMIT = '<40-character accepted Core commit>'
$env:REFERENCE_STORE_EXPECTED_CORE_VERSION = '1.2.0'
npm run gate:app-proxy-live
```

Do not set `SHOPIFY_APP_PROXY_SECRET`, a Storefront/Admin token, a Core invite,
or a tenant key in the harness process. The harness rejects known secret
bindings because they belong only in the server deployment.

## Pass conditions

The gate exits zero only when all of these are true:

- Node is version 22, the repository is clean, and commit/tree/package version
  match the expected identities.
- A pinned Playwright browser is available and the preview remains on the exact
  HTTPS permanent shop origin.
- Status is connected `shopify_read_only` using
  `shopify_storefront_graphql`; doctor is fully healthy.
- All ten POST runs return Search Contract v2 `results` containing the expected
  handle and explicit non-transactional, non-purchasable, write-disabled
  boundaries.
- No legacy route, unexpected runtime route, cross-origin runtime API, browser
  credential header, query/credential storage hit, console error, page error,
  synthetic fallback, or commerce write is observed.

Missing environment, a missing browser, HTTP, a mismatched shop/theme/component
identity, fewer than ten cases, or any boundary violation exits nonzero.

## Evidence and privacy

The evidence root must not already exist and must be outside the repository.
The harness creates it without clobbering existing data and writes:

- `receipt.json`
- `manifest.json`
- `manifest.sha256`

The receipt contains only case ID, pass status, result count, latency, expected
component identities, hashed shop/origin identity, theme ID, aggregate counts,
and safety counts. It does not contain query text, response bodies, product
handles, cookies, HMAC/signature values, tokens, raw headers, or the preview
URL. The closed output contract is
[`reference-store-live-app-proxy-receipt.v1.schema.json`](../contracts/reference-store-live-app-proxy-receipt.v1.schema.json).

A passing receipt is evidence for only its exact theme, Store, BFF, Core, cases
hash, and browser. It does not authorize production deployment, theme
publication, a commerce write, or a broader Live availability claim.
