# Search Contract v2 storefront integration

This repository consumes Search Contract v2 from Agent Core. It does not
reimplement product identity parsing, synonym expansion, hard-filter logic,
soft-context ranking, relaxation, or terminal-miss rules.

The browser calls the merchant-controlled Storefront BFF. The BFF forwards an
allowlisted contract envelope to authenticated Agent Core
`POST /api/search/v2`, maps only public product fields, and returns the
contract status and retrieval scope to the browser.

## Mock quickstart

The contract tests use synthetic records and an in-process mock of Agent Core.
They make no network requests and require no credentials:

```bash
git clone https://github.com/SuntekCorps-xLab/send-from-china-reference-store.git
cd send-from-china-reference-store
npm ci
node --test storefront-bff/test/worker.test.mjs
```

The tests prove both supported browser request shapes:

- a compact `{ "q": "desk tray" }` request, which the BFF wraps as an
  explicit `product_identity`; and
- a complete Search Contract v2 request, which the BFF forwards without
  applying storefront search rules.

They also cover opaque cursor pagination, `results`, `needs_clarification`,
`no_match`, and `degraded`, invalid upstream contracts, same-origin purchase
handoffs, and credential isolation.

Synthetic tests do not prove live inventory, availability, prices, shipping,
or sourcing progress.

## Live quickstart

Use an Agent Core deployment that advertises Search Contract v2 and implements
authenticated `POST /api/search/v2`.

```bash
cd storefront-bff
cp .dev.vars.example .dev.vars
npm ci
npm test
npm run dev
```

Configure the BFF only; never expose these values in Liquid or browser code:

```dotenv
AGENT_CORE_BASE_URL=https://agent-core.example.invalid
AGENT_CORE_TENANT_KEY=replace-with-a-server-secret
AGENT_CORE_PAGE_SIZE=20
STOREFRONT_ORIGIN=https://store.example.invalid
ALLOWED_ORIGINS=https://store.example.invalid
```

Send a complete contract through the BFF:

```json
{
  "search_contract": {
    "contract_version": "2.0",
    "product_identity": {
      "name": "product_identity",
      "value": "wood desk tray",
      "source": "explicit",
      "scope": "product",
      "hardness": "hard"
    },
    "hard_constraints": [
      {
        "name": "material",
        "value": "wood",
        "source": "explicit",
        "scope": "product",
        "hardness": "hard"
      }
    ],
    "soft_context": [
      {
        "name": "recipient",
        "value": "coworker",
        "source": "explicit",
        "scope": "session",
        "hardness": "soft"
      }
    ],
    "transaction_context": [
      {
        "name": "ship_to",
        "value": "US",
        "source": "explicit",
        "scope": "transaction",
        "hardness": "informational"
      }
    ],
    "limit": 20,
    "cursor": null
  }
}
```

Call `POST /api/search` on the BFF from the exact configured browser origin.
The response includes `contract_version`, `trace_id`, `status`,
`normalized_intent`, `relaxations`, `missing_criteria`, `results`,
`pagination`, and `search_scope`.

## Pagination

Treat `pagination.next_cursor` as opaque. When `has_more=true`, submit the same
normalized intent and hard constraints with that cursor. Do not decode a
cursor, change the product identity between pages, or infer a product total.

The BFF caps each page to the configured tenant-safe page size and a protocol
maximum of 50. Empty `next_cursor` with `has_more=false` is terminal for that
retrieval plan only; `global_catalog_exhaustive` separately reports whether a
global claim is justified.

## Status and error handling

Contract status is not an HTTP error:

| Status | Storefront behavior |
| --- | --- |
| `results` | Render the returned governed public products. |
| `needs_clarification` | Ask only for `missing_criteria`; do not source. |
| `no_match` | Offer an explicit sourcing choice only when the returned scope proves a terminal miss. |
| `degraded` | Keep the brief, show retry/browse actions, and do not call it a catalog miss. |

Transport and configuration failures use the BFF's small public error set:

| HTTP | Error | Meaning |
| --- | --- | --- |
| 400 | `invalid_search_request` | Browser payload or upstream contract request is invalid. |
| 429 | `rate_limited` | Retry only after the forwarded `Retry-After` value. |
| 502 | `upstream_authentication_failed` | Merchant configuration needs attention; no credential detail is exposed. |
| 502 | `search_contract_not_supported` | The configured Agent Core does not expose Search Contract v2. |
| 502 | `invalid_upstream_contract` | Upstream response failed the public contract allowlist. |
| 502 | `upstream_unavailable` | Network or upstream service failure. |
| 503 | `service_not_configured` | Required BFF configuration is absent or unsafe. |

Do not translate a network failure, unsupported version, invalid response, or
`degraded` state into `no_match`.

## Compatibility boundary

The compact browser `{q, limit, cursor}` shape is a storefront convenience,
not an Agent Core v1 fallback. The BFF wraps `q` only as an explicit product
identity and still calls Search Contract v2. Rich clients should send the full
contract.

An older Agent Core without `POST /api/search/v2` fails closed with
`search_contract_not_supported`. This repository intentionally does not copy
the Agent Core v1 adapter or silently downgrade, because that could give the
three search entry points different candidate truth.

Shopify remains the transaction source of truth. A search result is not a
confirmed variant, price, inventory level, delivery rate, cart, or checkout.
