# Supply-chain and SBOM policy

The repository uses locked npm installs, pinned GitHub Action commit SHAs,
Dependabot, CodeQL, dependency review where available, public-safety scanning,
and CycloneDX SBOM generation.

Generate the repository SBOM locally with:

```bash
npm ci
npm run sbom
```

The command derives three documents from the root, Storefront BFF, and Customer
Account lockfiles. Do not hand-edit or commit generated SBOMs. CI publishes the
`artifacts/sbom/` directory so each document can be associated with its exact
commit and lockfile.

Before changing a pinned action SHA or adding a runtime dependency, document
the package owner, purpose, license, release provenance, maintenance status,
and removal path in the pull request. Boundary or dependency changes require
the additional review described in `docs/MAINTAINERS.md`.

An SBOM is an inventory, not a vulnerability attestation. Releases still need
the audits, tests, and public scan in `docs/PUBLIC_RELEASE_CHECKLIST.md`.
