# Reference Store v1.1.0 release candidate

This document is a release-note source, not a declaration that `v1.1.0` has
already been published. The GitHub Release is authoritative only after it is
created from the exact reviewed commit.

## Included

- Search Contract v2 through the credential-isolating Storefront BFF.
- Shopify read-only sandbox and same-origin App Proxy contracts.
- Exact-SHA paired synthetic verification with Agent Core.
- Chromium, Firefox, and WebKit desktop/mobile QA.
- A zero-account hosted synthetic storefront candidate.

## Not included

- A public claim of Live Shopify connectivity before the real 10/10 App Proxy
  journey gate passes.
- Browser-held Agent Core or Shopify credentials.
- Shipping quotes, compliance decisions, sourcing writes, catalog writes,
  cart creation, checkout completion, orders, or payments.
- Production product, customer, order, or merchant data in this repository.

## Compatibility

Reference Store `1.1.x` consumes Agent Core Search Contract `2.0`. The release
must pin the exact accepted Agent Core commit and status-schema SHA-256 in
`scripts/paired-integration-smoke.mjs`; a branch name is not a release lock.
See [the compatibility matrix](COMPATIBILITY.md).

## Install and upgrade

```bash
git clone https://github.com/SuntekCorps-xLab/send-from-china-reference-store.git
cd send-from-china-reference-store
git checkout v1.1.0
npm ci
npm run verify
```

Before upgrading a merchant integration, deploy the BFF and theme only to a
development store or unpublished theme. Re-run `npm run verify:paired` against
the exact Agent Core release checkout and retain the sanitized artifact.

## Rollback

Keep the previous Worker version, theme ID, app version, and Reference Store
tag. Roll back the BFF first, restore the previous unpublished theme/app
candidate, then verify status and one bounded read-only search. Never solve a
contract mismatch by exposing a credential to browser code or silently falling
back from Shopify read-only to synthetic.

## Evidence required on the GitHub Release

- Reference Store commit and tree.
- Accepted Agent Core commit, tree, and status-schema SHA-256.
- 20/20 paired artifact with zero external requests and both worktrees clean.
- Core-compatible `agent-core-reference-store-paired-e2e/v1` artifact generated
  from observed exact commit/tree identities, with
  `app_proxy_live_verified=false` until the separate live gate passes.
- Successful CI, CodeQL, dependency audit, public safety scan, SBOM, and
  three-browser QA links from the release commit. The browser and safety jobs
  each upload a closed `send-from-china-reference-store-ci-evidence/v1`
  artifact bound to the checked-out commit and tree; raw logs, queries,
  responses, hosts, paths, and credentials are not release evidence.
- Hosted demo bundle digest if a public synthetic URL is published.
- Explicit statement that real App Proxy connectivity is unavailable unless a
  separate 10/10 evidence record is linked.
