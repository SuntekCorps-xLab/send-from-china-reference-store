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

