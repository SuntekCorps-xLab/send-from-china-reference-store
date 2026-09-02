# Paired Local Quickstart

This exercise proves that an external storefront can call Agent Core through
the public HTTP contract while keeping the tenant credential out of the browser
response. It uses only the two public repositories and their synthetic data.
It does not require Shopify, a hosted account, or private source code.

## 1. Start Agent Core

```bash
git clone https://github.com/SuntekCorps-xLab/send-from-china-agent-core.git
cd send-from-china-agent-core
npm ci
npm run setup
npm run verify
npm run dev
```

Keep that terminal open. The local Worker listens on
`http://127.0.0.1:8787` and uses the obvious test key from its generated
`governance-worker/.dev.vars` file.

## 2. Exercise it through the Storefront BFF

In a second terminal:

```bash
git clone https://github.com/SuntekCorps-xLab/send-from-china-reference-store.git
cd send-from-china-reference-store
npm ci
export AGENT_CORE_BASE_URL="http://127.0.0.1:8787"
export AGENT_CORE_TENANT_KEY="key_test_alpha_1234567890"
npm run smoke:integration
```

PowerShell environment syntax:

```powershell
$env:AGENT_CORE_BASE_URL = "http://127.0.0.1:8787"
$env:AGENT_CORE_TENANT_KEY = "key_test_alpha_1234567890"
npm run smoke:integration
```

The smoke test calls public capability discovery and catalog search, then
invokes the BFF in process exactly as a browser-facing adapter would. It checks:

- the local Agent Core advertises Search Contract v2;
- the BFF authenticates server-side;
- a complete Search Contract v2 reaches Agent Core without storefront search rules;
- a catalog miss remains a truthful terminal miss;
- the result page exposes its requested limit and the terminal miss reports a
  complete, exhausted, non-degraded retrieval scope;
- a derived browse link is not presented as purchase evidence; and
- the tenant key never appears in the browser response.

## What this does not prove

The exercise does not call a supplier, return a real shipping rate, create a
cart or order, process payment, or run a durable sourcing job. Replace the test
key before sharing any deployment. A hosted operator must provision a tenant
credential separately; there is no browser registration flow in either
repository.

## Run the release harness from two local checkouts

The lower-level smoke above is retained for adapter debugging. Before a paired
release, run the deterministic 20-journey gate from Reference Store instead:

```bash
npm run verify:paired
```

The gate starts both loopback runtimes itself and writes a sanitized ignored
artifact to `build/paired-e2e-v0/artifact.json`. Review that its two commit SHAs
match the intended release commits and both working trees are `clean`. See the
[paired E2E v0 contract](../evals/paired-v0/README.md) for coverage and the
explicit synthetic-data limitations.

## Exact local Core and read-only provenance

The paired release candidate expects Core
`1d4ada0a38bdf30a7dc5a2646b8ea56e28fa0d2a`, as declared in the
[compatibility lock](COMPATIBILITY.md#shopify-read-only-release-lock).
Use an already prepared checkout owned by the Core workstream:

```powershell
$env:AGENT_CORE_DIR = "..\agent-core-hosted-sandbox-worktree"
npm run verify:paired
```

Both paired entry points reject a different Core commit, a dirty Core tree,
an active Git operation or lock, and a changed status-contract schema before
importing Core. They repeat the check after closing the runtimes. All provenance
commands set `GIT_OPTIONAL_LOCKS=0`; reading status cannot refresh the Core
index. The test runner imports Core's in-memory loopback sandbox. It does not run
`npm ci`, setup, build, verify, or any write command in the Core checkout.
The initial setup steps in this guide are for a separately owned clone, never
for another workstream's active checkout.

Paired artifacts are restricted to this Reference Store's ignored `build/`
directory. A pre-commit run reports the Reference working tree as dirty; the
release receipt must be rerun after the linear Reference commit so that both
recorded revisions are exact and clean.

This 20-journey suite remains synthetic. The Shopify release separately requires
the Liquid three-browser/two-viewport matrix and ten protected
App Proxy -> Core -> dedicated development-store read-only journeys. Missing
staging or development-store authorization remains a Live-only blocker.

## Actual Core with injected Shopify reads

Run the new three-route pairing against the same exact accepted Core:

```powershell
$env:AGENT_CORE_DIR = "..\agent-core-hosted-sandbox-worktree"
node scripts/paired-shopify-smoke.mjs
```

This imports the accepted Core's real Shopify sandbox/provider and its checked-in
public fixture helpers. The provider's explicit injected `fetchImpl` supplies
Shopify responses; all actual network calls are bounded to the local Core.
The real BFF verifies signed App Proxy requests for status, doctor, and ten
read-only runs, covering public media, price/currency, sold-out truth, a terminal
miss, bounded limits, Unicode input, non-transactional boundaries, and credential
isolation. Invalid proxy signatures and all three legacy routes fail without a
Core call.

The sanitized receipt is `build/paired-shopify-smoke/artifact.json`. It records
both repository identities and counts, without queries, product data, credentials,
request/response bodies, or hosts. It explicitly states that neither a real
Shopify connection nor the Shopify-operated App Proxy was exercised. This
injected actual-Core check complements the real Liquid browser matrix; ten live
development-store journeys remain a separate staging gate.
