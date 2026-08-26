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
