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
