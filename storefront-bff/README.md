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
| `AGENT_CORE_PAGE_SIZE` | No | Must not exceed that tenant's `max_page_size`; defaults to `5` |
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

A URL derived from a returned slug is exposed as `url` and `browse_url`, but is
not proof that a Shopify product is purchasable. `product_url` remains empty
unless Agent Core explicitly returns an HTTPS product URL on the configured
`STOREFRONT_ORIGIN`. The BFF sets `available=true` only when that verified URL
is accompanied by `purchasable=true`. Supplier and cross-store URLs are
discarded. `STOREFRONT_ORIGIN` must be an exact HTTPS origin without a path,
credentials, query, or fragment.

This is a reference adapter, not a customer identity service. Authenticated
sourcing writes and saved state belong behind the Customer Account boundary.
