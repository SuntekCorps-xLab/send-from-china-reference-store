# Public repository release checklist

These controls live in GitHub settings and cannot be proven by files alone.
Record the completed settings and links in the release review.

1. Resolve all source-only adapter and public-boundary findings on the reviewed
   commit before changing visibility.
2. Keep the repository private until the zero-account Demo, connected BFF
   criteria flow, responsive browser QA, and public safety scan pass on the
   reviewed commit; then make that exact commit public.
3. Enable private vulnerability reporting, secret scanning, and push
   protection.
4. Confirm the pinned CodeQL and public dependency-review jobs succeed.
5. Create a `main` ruleset requiring pull requests, at least one approval, the
   demo/BFF, Customer Account, theme, safety, dependency-review, and CodeQL
   checks, and block force pushes and branch deletion.
6. Confirm Dependabot alerts and security updates are enabled.
7. Run the public safety scan and inspect the complete Git history for
   credentials, customer data, private integrations, and production hosts.
8. Repeat the zero-account quickstart from a clean external checkout and verify
   that Demo mode, illustrative cards, and unsupported carrier rates are
   visible without reading implementation code.
9. Check out the intended Agent Core commit beside this repository, run
   `npm run verify:paired`, and retain the sanitized paired E2E artifact as
   review evidence. Require 20/20 passing journeys, zero external network
   requests, two clean working trees, and exact commit SHAs matching the
   release candidates.
10. Retain both paired outputs. The v0 diagnostic artifact preserves sanitized
    per-journey results; the v1 release artifact must validate with
    `npm run verify:paired-release-artifact`, bind the observed Core and Store
    commit/tree identities, and show exactly 20/20 synthetic passes.
11. Download the independent `reference-store-browser-evidence` and
    `reference-store-safety-evidence` CI artifacts. Each must bind the release
    commit/tree and pass the closed CI evidence contract. A synthetic artifact
    must not claim real App Proxy verification.
12. Create the `v1.1.0` release from the exact reviewed commit and link its CI
   and security evidence.
