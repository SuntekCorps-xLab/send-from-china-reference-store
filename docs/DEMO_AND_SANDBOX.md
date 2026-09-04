# Demo and Sandbox Guide

This repository exposes synthetic local experiences plus a separately started
Shopify development-store read-only sandbox. Every mode is non-transactional,
omits shipping-rate promises, and has no commerce write path. The Shopify path
is documented in the
[Shopify development-store read-only sandbox](SHOPIFY_READ_ONLY_SANDBOX.md).

## Pick the mode that answers your question

| Mode | Start command | Data path | Best for |
| --- | --- | --- | --- |
| Simulated demo | `npm run demo` | Browser → local deterministic fixtures | Reviewing UI states with no second repository, account, or key |
| Connected local sandbox | `npm run demo:platform` | Browser → Reference Store demo BFF → local Agent Core sandbox | Proving the public repositories and their guarded HTTP contract work together |
| Shopify development-store read-only | `npm run demo:shopify` | Browser → Reference Store BFF → Agent Core Sandbox → Shopify Storefront API | Verifying published product, price, `availableForSale`, and same-store product URL truth without writes |
| Bring-your-own verified local sandbox | `npm run demo:connected` | Browser → Reference Store demo BFF → a separately operated loopback sandbox | Advanced testing when an operator provides both the verified sandbox runtime and a test-tenant token |

The mode is selected when the server starts. The mode cards in the page are
read-only status indicators, not a browser-side switch. This prevents the UI
from pretending that a connection exists.

## Run the zero-account simulated demo

```bash
npm ci
npm run demo
```

Open <http://127.0.0.1:4173>. The active mode reads **Simulated demo**. No
network service beyond this local process is contacted.

The scenario lab exposes four deterministic contract states:

| Scenario | Expected state | Truth check |
| --- | --- | --- |
| ✅ Catalog match | Three synthetic illustrative cards | Cards remain non-purchasable and do not claim availability |
| 🔎 Terminal miss | No cards | A bounded miss does not silently start custom sourcing |
| 💬 Needs detail | Clarification request | Missing criteria are requested before a result claim |
| 🛟 Safe failure | Degraded state | An unavailable service is not relabelled as a catalog miss |

Open **Sanitized contract inspector** after running a scenario. It shows the
browser request and an allowlisted projection of the response. It intentionally
excludes credentials, tenant configuration, upstream request headers, and raw
provider payloads.

In connected mode these same controls become **Sample queries**. They do not
select or predict a result state: the response returned by Agent Core decides
whether the journey is results, clarification, terminal miss, or a failure.

## Run both public repositories together

```bash
git clone https://github.com/SuntekCorps-xLab/send-from-china-agent-core.git
git clone https://github.com/SuntekCorps-xLab/send-from-china-reference-store.git
cd send-from-china-reference-store
npm ci
npm run demo:platform
```

The launcher finds a sibling directory named `send-from-china-agent-core` or
`github-agent-core`, starts its synthetic sandbox, starts the Reference Store
in connected mode, and prints both loopback URLs. To use another checkout:

```bash
npm run demo:platform -- --agent-core ../my-agent-core
```

The browser only talks to the Reference Store. The local Agent Core token is
passed server-to-server and never appears in HTML, JavaScript, the inspector,
or the browser response.

The launcher returns only after the Reference Store has strictly verified the
Agent Core `/sandbox/status` identity and an authenticated read against the
canonical snapshot API. A configured URL alone is never displayed as a live
connection.

## Connect to an already running local Agent Core

Most developers should use `npm run demo:platform`; it passes the temporary
sample token between the two server processes without displaying or copying it.
Use this manual mode only when an operator has separately issued a test-tenant
token for an Agent Core process you already run on loopback.

Start Agent Core first, then provide its loopback URL and test token to the
Reference Store process. These values belong in the server environment, never
in browser code.

macOS or Linux:

```bash
export AGENT_CORE_BASE_URL="http://127.0.0.1:8787"
export AGENT_CORE_TENANT_KEY="replace-with-an-operator-issued-test-tenant-token"
npm run demo:connected
```

PowerShell:

```powershell
$env:AGENT_CORE_BASE_URL = "http://127.0.0.1:8787"
$env:AGENT_CORE_TENANT_KEY = "replace-with-an-operator-issued-test-tenant-token"
npm run demo:connected
```

Connected mode fails closed when either server value is absent. It does not
fall back to fixtures while labelling the page connected, and it rejects a
non-loopback Agent Core URL or demo bind address. The standalone Agent Core
sandbox does not print its temporary token; `demo:platform` is the supported
automatic handoff.

`GET /api/status` separates configuration from readiness:

| State | Status fields | UI wording |
| --- | --- | --- |
| Verified sandbox + authenticated snapshot | `configured=true`, `reachable=true`, `verified=true`, `live_agent_core=true` | Connected local sandbox |
| Loopback URL configured but unreachable | `configured=true`, `reachable=false`, `verified=false`, `live_agent_core=false` | Configured · unavailable |
| Reachable service with the wrong sandbox identity or token | `configured=true`, `verified=false`, `live_agent_core=false` | Configured · unverified |

Identity verification requires the exact synthetic sandbox response and
boundary headers; authentication verification uses a bounded, read-only
canonical search. Until both pass, `/api/chat` and `/api/search` return
`sandbox_not_ready` rather than a fabricated match or miss.

## What the local contract proves

- Runtime mode and data provenance are explicit through `/api/status`.
- Scenario is an offline-fixture hint only. Connected requests send sample
  queries and let the upstream contract determine the state.
- Agent Core authentication stays behind the Reference Store BFF.
- Results are re-locked as synthetic, illustrative, unavailable, and
  non-purchasable before they reach the browser.
- Terminal miss, clarification, and degraded states remain distinguishable.
- No route creates a sourcing task, cart, checkout, order, payment, or shipping
  quote.
- The demo exposes only browser-safe chat and search calls. Catalog enumeration
  is intentionally absent because the sample tenant forbids full enumeration;
  the production BFF contract remains documented separately.

The connected sandbox proves integration mechanics against a synthetic Agent
Core snapshot. It does not prove supplier connectivity, live inventory,
merchant catalog completeness, shipping availability, or production tenant
isolation.

## Hosted synthetic storefront candidate

The repository includes a deployment-disabled Worker candidate in
[`hosted-demo/`](../hosted-demo). It hosts the same browser assets and answers
only the deterministic synthetic runtime contracts. It needs no account or
credential and has no upstream network or commerce path.

This does not turn the connected sandbox into an anonymous production API.
Publishing a merchant-connected service still requires least-privilege scopes,
tenant isolation, quotas, revocation, abuse monitoring, audit logs, and an
explicit data-retention review. See the
[hosted synthetic demo guide](HOSTED_SYNTHETIC_DEMO.md).

## Troubleshooting

- **Agent Core sandbox not found:** pass `--agent-core` to
  `npm run demo:platform`, or set `AGENT_CORE_DIR` in the server shell.
- **Connected mode requires Agent Core:** set both server environment variables,
  or use `npm run demo:platform` to start the paired runtimes automatically.
- **Connected URL is rejected:** the local sandbox accepts loopback Agent Core
  URLs only; use `127.0.0.1` or `localhost`, never a hosted or production URL.
- **Port already in use:** set `DEMO_PORT` or `AGENT_CORE_SANDBOX_PORT` before
  starting the platform command.
- **Status says simulated:** stop the process and restart it with
  `npm run demo:connected` or `npm run demo:platform`; the page cannot change
  the runtime mode.
- **No product cards:** check the selected scenario. Terminal miss,
  clarification, and degraded fixtures intentionally return none.

For a lower-level contract exercise without the browser UI, see
[Paired Local Quickstart](PAIRED_LOCAL_QUICKSTART.md).
