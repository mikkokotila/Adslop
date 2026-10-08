# Security assurance case

This page argues, requirement by requirement, why this repository meets its
security requirements, and names the mechanical evidence for each argument. It
is the entry point for judging the posture; [SECURITY.md](../../SECURITY.md)
defines how to report a suspected failure of any claim here.

The honesty gate proves the declared laws and the enforced checks are in
bijection. It does not argue the gate set is *sufficient*. This page is that
argument, and it belongs here rather than downstream: a repository derived
from this template inherits the posture, so the reasoning should travel with
it.

## Prerequisites

- none for reading; the verification commands need the [GitHub CLI](https://cli.github.com)

## What this is, for threat modelling

A repository template: governance gates, workflows, and a seed package. It has
no server, no accounts, no authentication surface, and stores no credentials.
The security-relevant surface is therefore the repository itself — what code
can reach `main`, what dependencies ship, and whether a released artifact is
what CI built.

## Trust boundaries

| boundary | what crosses | position |
| --- | --- | --- |
| Issue and PR bodies | user-authored markdown parsed by the slice gate | untrusted input to a required gate |
| Third-party dependencies | packages in `pyproject.toml` and `requirements/ci/*` | vetted at merge and weekly |
| GitHub Actions | workflow tokens and third-party actions | least privilege, SHA-pinned |
| Release pipeline | tags, artifacts, PyPI publication | mechanical, no long-lived tokens |

## Requirement 1: only reviewed, gate-passing code reaches main

**Argument.** Direct pushes are impossible and every merge needs review plus a
fixed set of green checks, so no single actor can land unreviewed code.

**Evidence.** The `Protect-Main` ruleset requires pull requests with non-author
approval, code-owner review on the enforcement surfaces in
`.github/CODEOWNERS`, and every required status check; force pushes and branch
deletion are blocked. `pr_checks_ruleset` fails when the live ruleset drifts
from `.github/rulesets/main.json`, and `audit_main_ruleset` re-checks it after
merge with a privileged token — including `bypass_actors`, which the PR-time
gate structurally cannot observe.

## Requirement 2: the declared laws are the enforced laws

**Argument.** A gate cannot be dropped, and a law cannot be added, without the
other changing with it.

**Evidence.** `pr_checks_honesty` asserts a bijection between the
`*(context)*` annotations in `CLAUDE.md`'s laws and the required status checks
in the ruleset snapshot. Dropping a gate from the ruleset fails the gate;
adding one without a law fails it too.

## Requirement 3: known-vulnerable dependencies cannot enter or persist silently

**Argument.** Findings block merges unless explicitly excepted with a reason
and an expiry, and update pressure is continuous, so exposure windows are
bounded and always on the record.

**Evidence.** `check_dependency_vulnerabilities.py` runs pip-audit over the
declared dependencies inside `pr_checks_lint`; exceptions live in
`.github/vuln_exceptions.json` with mandatory `id`, `reason` and `expiry`, and
an expired exception fails again. Dependabot proposes weekly updates for pip,
github-actions and npm. Every declared dependency carries both bounds, which
`scripts/package_audit.py` enforces — an unbounded dependency lets a resolver
change what ships between two builds of one version.

## Requirement 4: CI credentials follow least privilege and stay out of PR reach

**Argument.** Workflow tokens grant the minimum scope, third-party actions
cannot drift, and checked-out credentials are not persisted, so PR-supplied
code has no standing capability to escalate.

**Evidence.** Every workflow declares least-privilege top-level `permissions:`
with write scopes only at job level; every action reference is pinned to a
full commit SHA with its release tag in a comment; every checkout sets
`persist-credentials: false` except the release tag push, which is the single
documented exception. All of these are asserted by
`governance/tests/test_supply_chain.py`.

## Requirement 5: released artifacts are what CI built, and consumers can check

**Argument.** No human hands touch the publish path, the build is
reproducible, and every artifact ships with provenance a consumer can verify
independently.

**Evidence.** Distributions build under a fixed `SOURCE_DATE_EPOCH` and
`pr_checks_packaging` asserts two builds are byte-identical — the sdist only
because `build_backend.py` normalises its archive metadata. Releases are attested with `actions/attest-build-provenance`, verifiable
through the GitHub attestation API; PyPI publication uses trusted publishing
(OIDC) from the `pypi` environment with no long-lived token, and is inert
unless a repository variable enables it. No SBOM or offline provenance bundle
is produced, and neither the policy nor this page claims one. A pre-build guard rejects a
version PyPI has already served.

## Requirement 6: untrusted input cannot crash a required gate

**Argument.** The parsers fed arbitrary text always return rather than raise,
so a malformed issue body is an authoring mistake rather than a broken gate.

**Evidence.** `governance/tests/test_issue_body_parsers.py` exercises the
extractors with Hypothesis on every PR, inside an already required check. The
invariant is narrow and deliberate: what they return on nonsense is the gate's
business; that they return at all is the property test's.

Coverage-guided fuzzing (Atheris) was tried first and withdrawn: it ships no
wheels for Python 3.12 or later and cannot build against this repository's
floor, so the workflow could not install its own dependency. Property-based
testing reaches the same invariant, runs as a required check rather than an
advisory workflow, and shrinks a failure to a minimal reproduction.

## Requirement 7: static analysis runs on every change

**Argument.** Independent analysers and a strict type gate run as required
checks, so common defect classes are caught before merge.

**Evidence.** CodeQL and ruff run as required checks; pyright runs in strict
mode with both errors and warnings ratcheted against
the `typing` budget in `.github/budgets.json`; OpenSSF Scorecard re-analyses every push to
`main` and publishes the result.

## Residual risks

- The template ships no runtime dependencies, so the dependency-vulnerability
  gate is a vacuous pass here. It becomes meaningful only once a derived
  repository declares some — the gate is inherited, the assurance is not.
- The property tests cover the issue-body parsers only. Other parsing surfaces
  a derived repository adds are not covered by inheritance.
- Property-based testing explores a generated space; it is not coverage-guided.
  It is a weaker guarantee than fuzzing against a native harness would give,
  and it is what is actually installable here.
- The contributor base is a single organisation; continuity and access rules
  are in [GOVERNANCE.md](../../GOVERNANCE.md) and [MAINTAINERS.md](../../MAINTAINERS.md).

## Verifying the claims

```bash
gh api repos/<owner>/<repo>/rulesets --jq '.[].name'
gh attestation verify <artifact> --repo <owner>/<repo>
python -m pytest governance/tests -q
```

The first lists the active rulesets, the second verifies a downloaded artifact
against its published provenance, and the third runs every contract test that
pins the claims above.

## Read next

- [Release Policy](Release-Policy.md)
- [Packaging](Packaging.md)
- [Developer home](README.md)
