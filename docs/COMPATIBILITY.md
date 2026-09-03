# Compatibility matrix

| Reference Store | Agent Core search contract | Browser request | Runtime | Behavior |
| --- | --- | --- | --- | --- |
| `main` / next minor | `2.0` | Full `search_contract` | Node.js 22 and 24; modern Worker `fetch` | Preferred, preserves all intent groups and retrieval scope. |
| `main` / next minor | `2.0` | Compact `{q, limit, cursor}` | Node.js 22 and 24; modern Worker `fetch` | Supported convenience wrapper; `q` becomes explicit product identity. |
| `1.0.x` | Agent Core HTTP v1 | Compact `{q, limit}` | Node.js 22 | Previous integration only; no automatic fallback from v2. |

CI runs the Search Contract v2 BFF tests on every supported Node.js line. The
browser-safe BFF must remain free of Agent Core tenant credentials and search
business rules in every mode.

If a configured Agent Core does not advertise or implement Search Contract v2,
the current BFF returns `search_contract_not_supported`. Operators must upgrade
Agent Core or deliberately remain on the previous Reference Store release;
silent protocol downgrade is not supported.

## Shopify read-only release lock

The Shopify Liquid/App Proxy candidate is paired with Agent Core commit
`e0fb5743a6ded2cceae18432786bccf946e71752`. Its
`contracts/shopify-live-sandbox-status.v1.schema.json` SHA-256 is
`30b38d767874351e7c56976a9b707cb1aa6c6764940cd7d338338cb1d01c7211`
(`shopify-live-sandbox-status/v1`, Storefront API `2026-07`).
The same immutable lock is enforced by
[`scripts/paired-integration-smoke.mjs`](../scripts/paired-integration-smoke.mjs)
and the 20-journey paired runner, before loading and after closing Core.

In `shopify_read_only`, the Liquid browser surface uses only the same-origin
App Proxy prefix plus `GET /api/runtime/status`,
`GET /api/runtime/doctor`, and `POST /api/runs`. It must never downgrade to
`/api/chat`, `/api/search`, `/api/catalog`, or a synthetic result.
Synthetic paired checks retain their existing legacy/HTTP/MCP contracts as a
separate regression suite; they are not evidence of Shopify connectivity.
