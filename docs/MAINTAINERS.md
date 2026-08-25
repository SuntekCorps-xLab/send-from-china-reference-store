# Maintainer Responsibilities

The repository owner appoints a named open-source maintainer team before public
contributions are merged. Maintainers own issue triage, code review, release
approval, vulnerability coordination, and the boundary between public examples
and private merchant systems.

## Review rules

- Every pull request requires one maintainer approval and all required checks.
- Changes to credentials, browser/server boundaries, customer state, commerce
  writes, workflows, dependencies, or releases require a second owner review.
- Reviewers must confirm the changed journey has an explicit loading, empty,
  failure, and unsupported state where applicable.
- No reviewer may approve credentials, customer data, merchant exports,
  production responses, private hosts, or unlicensed media.

## Release duties

The release owner records the exact commit, lockfiles, verification output,
safety scan, and release notes. Production deployment, theme publication, and
merchant writes are outside pull-request automation.
