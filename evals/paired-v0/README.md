# Paired E2E release harness v0

This harness runs exactly 20 deterministic journeys across sibling Reference
Store and Agent Core checkouts. It starts both runtimes on ephemeral loopback
ports, blocks every non-loopback `fetch`, uses only public synthetic fixtures,
and attempts no supported commerce write.

```bash
npm run eval:paired
```

Agent Core is resolved from a sibling `send-from-china-agent-core` or
`github-agent-core` directory. An explicit checkout and artifact path can be
supplied without contacting a hosted service:

```bash
npm run eval:paired -- --agent-core ../github-agent-core --output build/paired-e2e-v0/artifact.json
```

The versioned inputs are [`journeys.json`](journeys.json) and
[`journey.schema.json`](journey.schema.json). Coverage includes capability and
sandbox truth, HTTP Search Contract v2, MCP discovery/search, BFF chat/search,
origin and authentication rejection, credential isolation, browse/purchase
separation, cursor/refine behavior, and no-write boundaries.

`needs_clarification` and `degraded` cannot be produced naturally by the
current fixed Agent Core snapshot. Those two cases are labelled
`in_process_bff_synthetic_state`: they pass deterministic synthetic contract
responses through the real Reference Store BFF validator. They do not claim
that Agent Core produced those states in this release.

The ignored artifact at `build/paired-e2e-v0/artifact.json` records the exact
Git commit, tree, and clean/dirty status of both checkouts, dataset SHA-256,
case IDs, pass/fail status, and assertion counts. It contains no query, request,
response, URL, credential, product record, private data, or production data.

## Interpretation boundary

A pass proves the two exact local commits interoperate for these public
synthetic fixtures. It is not a production relevance evaluation, supplier or
carrier connectivity test, load test, live-inventory check, or proof of
merchant-specific behavior. It creates no cart, checkout, order, payment, or
durable sourcing task.

## Exact Core release gate

The runner and paired smoke share the
[checked-in Core revision and schema lock](../../scripts/paired-integration-smoke.mjs).
Before importing Core and after shutdown, they require its exact accepted
commit, clean working tree, no Git operation or lock, and matching status-schema
SHA-256. Git provenance reads disable optional locks so they cannot refresh the
Core index. No install, setup, build, or test process is run inside Core.

The output path must stay under this Reference checkout's ignored `build/`
directory. The runner never uses another checkout as an artifact destination.
See the [paired quickstart](../../docs/PAIRED_LOCAL_QUICKSTART.md) for the explicit
local checkout command and the distinction between synthetic evidence and
Shopify Live acceptance.
