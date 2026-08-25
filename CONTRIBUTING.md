# Contributing

This repository is in release-candidate review. Small, focused pull requests
with tests are preferred.

Before opening a pull request:

1. Do not include store-specific config, credentials, catalog exports, customer
   data, screenshots with personal data, or production response payloads.
2. Run the customer-account tests, app build, theme check, browser QA, and public
   safety scan described in `docs/DEVELOPMENT.md`.
3. Explain the user-visible state transition being changed and the fail-closed
   behavior for unavailable services.
4. Keep production deployment, theme activation, and merchant writes outside
   pull-request automation.

Security reports must follow `SECURITY.md`, not the public issue tracker.

Start with a `good first issue` or `help wanted` item when available. For a new
idea, open a feature request and relate it to `ROADMAP.md` before implementing
it. Every accepted issue should identify the customer state transition, source
of truth, failure behavior, and observable acceptance check.

At least one named maintainer must approve every pull request. Boundary,
dependency, workflow, and release changes require a second owner review; see
`docs/MAINTAINERS.md`.
