# Review evidence

V1 release: `1.0.0`

Review date: 2026-08-24

Release reviews are commit-specific. Record the repository URL, `main` commit
SHA, review date, tool versions, successful commands, skipped commands and
reasons, dependency-audit output, and GitHub Actions links.

Required local evidence:

- zero-account demo route and chat contract test;
- storefront BFF unit tests, locked install, and high-severity dependency audit;
- clean locked dependency install;
- customer-account unit and contract tests;
- customer-account production build with non-deployable example config;
- Shopify Theme Check at error threshold;
- drawer browser QA with synthetic fixtures;
- repository safety scan;
- `git diff --check` and a clean worktree.

For the BFF, evidence must include rejected unknown origins, fail-closed missing
configuration, Agent Core `GET` search adaptation, and confirmation that the
tenant key is present only in the upstream request.

Repository administrator evidence such as branch protection, required checks,
private vulnerability reporting, and secret scanning must be verified on
GitHub and cannot be inferred from files in the repository.

## V1 recorded results

The 2026-08-24 V1 run produced:

- 33 of 33 zero-account demo, BFF, theme contract, and Customer Account tests
  passing;
- empty and invalid demo chat requests failing closed, `/api/status` declaring
  synthetic mode, and every fixture card labelled illustrative;
- structured criteria remaining intact across the browser-safe BFF boundary;
- desktop and mobile Shopping Agent drawer QA passing;
- three Customer Account Workspace browser scenarios passing at desktop and
  mobile viewports;
- the installable order-tracking extension building successfully from the
  non-deployable `example.invalid` configuration;
- Shopify Theme Check completing with zero errors (upstream theme warnings
  remain informational);
- zero high-severity npm audit findings across root, BFF, and Customer Account
  lockfiles;
- local documentation links, current-tree public safety scan, Git diff check,
  and credential/private-host history probes passing.

## Unreleased integration verification

On 2026-08-25, `npm run verify` passed on the current tree with 37 of 37 tests,
desktop and mobile drawer QA, documentation-link checks, and the public safety
scan. The live cross-repository smoke command remains optional and requires a
controlled Agent Core deployment plus a test tenant key. Record its target
release and result separately when it is run; do not treat an offline unit test
as evidence of deployment reachability.

GitHub Actions must pass on the exact release commit before the `v1.0.0` tag is
created or repository visibility is changed.

## 2026-08-27 Green Gate baseline freeze

Before the Shopify BFF starter work began, the release baseline was frozen at
`main@1a59d46993ecf5bad161dc07982b3df299749435`.

- [CI run 32950207295](https://github.com/SuntekCorps-xLab/send-from-china-reference-store/actions/runs/32950207295) completed successfully on that exact SHA.
- [CodeQL run 32950207310](https://github.com/SuntekCorps-xLab/send-from-china-reference-store/actions/runs/32950207310) was skipped because the repository was private. This is recorded
  as `N/A (private)`, not as a passing security scan.
- CodeQL now supports an explicit `workflow_dispatch`. It must be run and pass
  after the repository becomes public and before the public Green Gate closes.

This baseline evidence remains immutable. The new BFF starter requires its own
exact-commit CI result before release.

### BFF starter candidate verification

On 2026-08-27, `npm run verify` and `git diff --check` passed for the BFF starter
candidate. The run included 71 Node.js demo, BFF, Shopify, Customer Account,
and starter tests; desktop/mobile drawer QA; local-link validation; and the
public safety scan. Root, Storefront BFF, and Customer Account npm audits each
reported zero vulnerabilities at the high-severity threshold.

The implementation was committed as
`cf972e2d5ece9c52ddd36382db6e45a6ec975b93`. GitHub
[CI run 33042081200](https://github.com/SuntekCorps-xLab/send-from-china-reference-store/actions/runs/33042081200)
completed successfully on that exact SHA. Its
[CodeQL run 33042081088](https://github.com/SuntekCorps-xLab/send-from-china-reference-store/actions/runs/33042081088)
was skipped while the repository was private and is therefore recorded as
`N/A (private)`, not as a passing scan. Any later documentation or release
commit must also receive an exact-commit CI result; CodeQL must run and pass
after the repository becomes public.

## 2026-09-02 Shopify Liquid/App Proxy candidate

Scope is a single local Reference Store candidate paired with the accepted S1
Core revision in [COMPATIBILITY.md](COMPATIBILITY.md). The starting Reference
commit was `0179b8606ea18853b2669ddeffa9494a39a40550`, tree
`aaceeb62267d35303630e84a3065ecd091508641`. No production deployment,
theme publication, main merge, push, or operating-store write is authorized.

Paired-gate implementation checks on the pre-commit working tree passed:

- `node --test evals/paired-v0/test/*.test.mjs`: 9/9, including exact-SHA
  rejection, tracked/untracked changes, active Git operation/lock, schema
  mismatch, artifact-path confinement, and unchanged Core-style Git index
  timestamp after a status refresh.
- `node scripts/check-doc-links.mjs`: passed.
- `node scripts/scan-public.mjs .`: passed.
- `git diff --check`: passed.

Fixtures for the gate tests are created and removed only inside Reference
`build/`. Core provenance checks disable optional Git locks. Paired execution
imports its in-memory loopback sandbox without running installs, setup, build,
verification, or artifact writes in that checkout.

Final acceptance must record the exact accepted Core SHA and the local
Reference commit, then rerun paired evidence with both working trees clean.
The synthetic 20-journey paired receipt and any local Liquid/injected browser
receipt do not establish protected staging or Shopify Live connectivity.
Ten real read-only App Proxy -> Core journeys remain conditional on an
authenticated unpublished-theme preview, protected staging/App Proxy, and the
separately authorized dedicated development store with server-held read
credentials. Missing dependencies are Live-only blockers, never passing tests.

### Final local validation

The accepted S1 identity was independently recomputed before pinning:
commit `1d4ada0a38bdf30a7dc5a2646b8ea56e28fa0d2a`,
tree `6c06be14d2cb64c2c090cb603ddf08ffdd715ca3`, parent
`c309bb9012607c2989c60bc8f012ef51b302c1cc`, clean. The status schema
SHA-256 remains
`30b38d767874351e7c56976a9b707cb1aa6c6764940cd7d338338cb1d01c7211`.

On Node 22.23.2, `npm run verify` passed: 115 unit/contract tests,
9 frozen triad tests, legacy drawer desktop/mobile, three account-workspace
cases, the actual Liquid matrix, documentation links, and public safety scan.
The separate existing `npm run qa:shopify` demo matrix also passed all six
browser/viewport cases. Shopify CLI 3.94.3 Theme Check inspected 324 files:
zero errors and 36 warnings. Remote GitHub CI was not run; no push occurred.

Actual Liquid QA used Chrome 152.0.7977.65, Firefox 148.0.2 and WebKit 26.4,
each at 1440x1000 and 390x844. All six cells and 42 journey groups passed.
The suite renders repository Liquid (including home, search, collection and
signed-in workspace) with local Shopify adapters; it does not use the remote
Shopify renderer. It exercises the real browser assets and BFF through a
signed App Proxy simulator with injected Core responses.

Checks cover status/doctor/runs, ten UI-driven injected read runs, credential
and permission failures, upstream failure, synthetic mode mismatch, rejected
cross-origin proxy configuration, degraded search, native Liquid collection
browsing, signed-in account isolation, focus trap/restore and composer layout.
There were zero unexpected console/page errors, serious/critical axe findings,
horizontal overflow, external browser requests, legacy runtime calls, persisted
queries, or exposed fixture credentials. Five browser resource-console messages
from deliberately injected HTTP 502/503 failures are separately counted;
they are not reported as zero total console messages. Reduced motion passed.

Local evidence is in ignored `work/shopify-liquid-qa/report.json` and 18 PNGs.
`work/s2-liquid-qa-receipt.json` additionally records the input SHA-256 map.
No screenshot or merchant data is included in this commit.

The original paired integration smoke passed, and the synthetic paired suite
passed 20/20 with all nine exact-lock regression tests passing.

The exact accepted Core implementation was also executed with its explicit
Shopify fetch injection, through the real BFF and signed proxy authentication:
`npm run smoke:shopify-paired` passed 10/10. Its receipt
`build/paired-shopify-smoke/artifact.json` records 12 local Core status reads,
10 local Core searches, one injected health probe, one injected catalog
readiness probe, ten injected catalog reads, and zero external requests.
Media, zero price, currency, sold-out state, terminal miss, bounded limits,
Unicode and the non-transactional boundary were checked. This receipt contains
case IDs and aggregate counts only. Rerunning after the single local commit
records the final clean Reference identity without another implementation
commit.

The remaining Live-only blockers are a dedicated authenticated development
store, an installed dedicated App Proxy, reachable staging Core/BFF bindings,
and an authenticated unpublished Shopify theme preview. Neither the 10/10
injected chain nor the Liquid render proves these prerequisites. Real Live
journeys remain unverified; no production publish, operating-store write,
main merge, push, or internal-preview acceptance is claimed.

## 2026-09-02 S2.1 Firefox startup gate

The independent failure on Reference parent
`0ca78aa899dc3da0df361b278dbbeda882e5d614` was reproduced with Node 22.23.2,
Playwright 1.59.1 and Firefox revision 1511 / 148.0.2. Even an isolated blank
page without Liquid, axe or HTTP fixtures failed at `browserContext.newPage`
with an undefined `_page`. Firefox process diagnostics reported
`Failed to launch tab subprocess @SB::LA::SpawnTarget (Error:0)`.

The identical blank-page command and installed binaries passed in the
authorized executor. Both execution environments reported Windows Medium
integrity. This identifies a content-process startup restriction in the outer
executor, not a storefront error, dependency mismatch, or UAC elevation issue.
The harness does not attempt to make that restricted executor compatible by
disabling Firefox protections or changing process permissions.

The gate now verifies the resolved Playwright pin, uses its effective browser
descriptors (including OS revision overrides and Chromium headless-shell),
and probes every requested engine before starting the application fixtures.
It closes contexts on initialization failure, preserves the original error,
and retains nonzero status. Reports include executable fingerprints, startup
stages and immutable per-run paths. The latest-report copy is not the retained
acceptance artifact. All existing behavior, accessibility, viewport, storage,
credential, network and reduced-motion assertions remain in place.

The restricted-executor regression still fails explicitly before fixture
startup with zero completed journeys; it is not counted as Firefox coverage.
The authorized Node 22 full gate includes Chrome/Firefox/WebKit at both
1440x1000 and 390x844, the 42 Liquid journey groups, the legacy browser tests,
unit/contract and paired-lock regressions, documentation links and public
scan. Synthetic paired 20/20 and injected actual-Core 10/10 remain distinct
from real Shopify Live acceptance. The final local receipt under
`work/s2-1-firefox-gate-receipt.json` binds these artifacts to the child commit
and unchanged Core pin. No browser installation or download is needed.

This repairs startup diagnosis, resource ownership and acceptance provenance.
Execution under an incompatible outer restriction is still a failed gate;
acceptance requires the complete matrix in an authorized compatible executor.
Live App Proxy 10/10 still awaits the dedicated S1 staging receipt and an
authenticated unpublished development-store theme.
