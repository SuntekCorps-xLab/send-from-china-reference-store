# Mini Suntek + Agent Core + Reference Store contract projection v1

This fail-closed harness evaluates 20 deterministic, public-synthetic cases
against three separately invoked surfaces:

1. Mini Suntek's committed client adapter;
2. Agent Core's committed local synthetic sandbox;
3. Reference Store's BFF and connected local demo.

Ten cases must return illustrative results and ten must preserve `no_match`.
The check compares status and result presence across all three repositories,
then compares the Core, BFF, and connected-demo synthetic identities in memory.
It never writes prompts, responses, titles, product IDs, or credentials to its
aggregate artifact.

## What this check does not prove

Mini's synthetic browser does not call Agent Core. The harness projects the
same fixture into Mini and, separately, into Core and Reference Store. Every
artifact therefore contains these immutable limitations:

- `claim_scope = synthetic_contract_projection`;
- `full_triad_e2e = false`;
- `authorizes_release = false`;
- `authorizes_live_preview = false`.

Passing this check is not the planned Mini -> Core -> Reference Store end-to-end
journey, a live relevance test, a browser test, or release approval. A separate
staging test with independently controlled network and write instrumentation is
still required for those claims.

## Run it

Use clean repository roots and the reviewed full 40-character Mini and Agent
Core locks. Also supply the exact clean Reference Store commit being evaluated.
The output must be a new absolute path under a trusted, access-controlled parent
outside all three repositories:

```powershell
npm.cmd run eval:triad-contract -- `
  --mini C:\checkouts\mini-suntek `
  --mini-sha 66528615e57886829ed695727e85e08b0cea3c90 `
  --agent-core C:\checkouts\send-from-china-agent-core `
  --agent-core-sha b527e8a43c8ffe580c7412837c86198230ef252c `
  --reference-store-sha <REFERENCE_STORE_SHA> `
  --output C:\trusted-evidence\triad\run-001.json
```

```bash
npm run eval:triad-contract -- \
  --mini /checkouts/mini-suntek \
  --mini-sha 66528615e57886829ed695727e85e08b0cea3c90 \
  --agent-core /checkouts/send-from-china-agent-core \
  --agent-core-sha b527e8a43c8ffe580c7412837c86198230ef252c \
  --reference-store-sha <REFERENCE_STORE_SHA> \
  --output /trusted-evidence/triad/run-001.json
```

There are no implicit sibling checkouts or abbreviated SHAs. The dataset,
schema, tests, and runner pin Mini and Agent Core before either repository's
JavaScript is loaded. Reference Store must equal the explicit SHA supplied by
the operator. All three working trees are checked before and after execution.
That reduces accidental baseline drift, but is not a signed official-ref
attestation and does not eliminate concurrent filesystem replacement. Formal
release evidence must run an archived source closure in a controlled runner.

## Network and execution boundary

The runner wraps global `fetch`, permits only an exact method + full loopback URL
allowlist, forces `redirect: manual`, and rejects redirects. Aggregate counters
are named `guarded_fetch_*` because the wrapper does not observe `node:http`,
`node:https`, `node:net`, child processes, native modules, or server-side traffic
that bypasses global `fetch`.

The Mini adapter uses `node:vm` only as a compatibility mechanism. `node:vm` is
not a security sandbox; running the harness trusts the two pinned local source
trees. Do not point this command at an unreviewed checkout.

The artifact is no-clobber, repository-external, and aggregate-only. Its parent
directory must already be trusted and protected from concurrent junction or
mount replacement. A contract pass requires 20/20 cases, zero production-like
records, and zero blocked/non-loopback/redirected guarded-fetch attempts.

`npm run test:triad-contract` validates the harness contract only. It does not run the
three repositories and does not generate exact-SHA evidence. Run `npm run
eval:triad-contract` explicitly after all three candidate commits are frozen.
