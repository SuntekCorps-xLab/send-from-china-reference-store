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
