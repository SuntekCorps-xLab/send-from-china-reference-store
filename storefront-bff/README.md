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

## Routes

- `GET /health`
- `POST /api/chat`
- `POST /api/search`
- `POST /api/catalog`

The Worker rejects unknown origins, malformed or oversized requests, and missing
configuration. It never returns the tenant key, upstream response bodies, or a
server stack. See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) for the
browser contract and trust boundaries.

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
