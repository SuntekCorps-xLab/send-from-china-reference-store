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
