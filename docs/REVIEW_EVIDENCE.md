# Review evidence

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
