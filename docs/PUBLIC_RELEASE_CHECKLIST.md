# Public repository release checklist

These controls live in GitHub settings and cannot be proven by files alone.
Record the completed settings and links in the release review.

1. Resolve all source-only adapter and public-boundary findings on the reviewed
   commit before changing visibility.
2. Make the repository public without changing that commit.
3. Enable private vulnerability reporting, secret scanning, and push
   protection.
4. Confirm the pinned CodeQL and public dependency-review jobs succeed.
5. Create a `main` ruleset requiring pull requests, at least one approval, the
   demo/BFF, Customer Account, theme, safety, dependency-review, and CodeQL
   checks, and block force pushes and branch deletion.
6. Confirm Dependabot alerts and security updates are enabled.
7. Run the public safety scan and inspect the complete Git history for
   credentials, customer data, private integrations, and production hosts.
8. Create the release candidate from the exact reviewed commit and link its CI
   and security evidence.
