# Security assurance and current limits

This page separates intended controls from evidence that they operate in
Adslop. [SECURITY.md](../../SECURITY.md) defines the reporting channel;
[SETUP.md](../../SETUP.md) owns repository setup and unresolved prerequisites.

## Current boundary

The repository contains governance tooling, documentation, and a package
baseline. The advertising service, accounts, tracking collector, and product
API described in the specification are not implemented. Their security
requirements cannot be satisfied by inheriting repository checks.

The repository is private and currently has one collaborator. The current
GitHub plan blocks activation of the intended live ruleset, and bootstrap and
privileged-audit secrets are not configured. CodeQL is not available for this
private configuration and is not claimed as an active check. These are
unresolved enforcement limitations, not passing controls.

## Declared controls and required evidence

| Boundary | Declared mechanism | Evidence needed before claiming enforcement |
|---|---|---|
| Changes reaching `main` | reviewed pull requests, owner review, required checks, no force pushes or bypass actors | active live ruleset matching the snapshot, qualified non-author review, exact-revision check results |
| Policy consistency | honesty/configuration tests compare laws, settings, workflows, and snapshot | successful contract tests; these alone do not activate GitHub protection |
| Dependencies | hash-pinned Python installs, npm lockfile, vulnerability audits, SHA-pinned actions | successful audits for the candidate and explicit records for any allowed exception |
| CI credentials | explicit workflow permissions and checkout without persisted credentials | workflow review, configured token scopes, and passing supply-chain checks |
| Private docs links | token sent only to recognized GitHub API resources under the configured repository | credential-scope tests and successful authenticated link checks |
| Artifacts | reproducible build backend, package-content audit, optional attested publishing | matching artifact digests and successful checks; public publication remains disabled |
| Input parsing | property tests for issue-body parsers | executed test results for those parsers; no claim for future product input surfaces |

## Interpretation

A locally passing gate establishes only the property it tested. It does not
prove that GitHub prevents an unreviewed merge. A missing audit credential or
unavailable ruleset must remain visible; bypassing the audit would not provide
replacement evidence.

The runtime dependency set is currently empty, so its audit says little about
a future application's dependency risk. Documentation and development
dependencies have their own lockfiles and checks. Newly implemented product
surfaces need their own threat model and tests.

The intended non-author approval requirement cannot be met by the sole
collaborator approving their own change. Review availability must be resolved
without silently reducing the policy. No public documentation deployment or
PyPI release is claimed by this repository baseline.

## Verification workflow

After opening the required pull request, run the contract tests and checks
identified by its workflows. With appropriate GitHub access, inspect live
rulesets and compare them to `.github/rulesets/main.json`:

```bash
gh api repos/mikkokotila/Adslop/rulesets
python -m pytest governance/tests -q
```

A forbidden or unsupported API response is an unresolved result, not an
empty valid ruleset. Record the exact revision, commands, outcomes, and
remaining setup dependency before asserting that a control is active.

## Read next

- [Developer guide](README.md)
- [Configuration](Configuration.md)
- [Release policy](Release-Policy.md)
- [Packaging](Packaging.md)
