# Release policy

What may publish this package, what a release must carry, and what may never
happen twice. [Making a Release](Making-Release.md) is the operational
sequence; this page is the controls that sequence runs under.

## Prerequisites

- the operational sequence in [Making a Release](Making-Release.md)
- maintainer authority over repository settings and the PyPI project, to
  change any control here

## Version rules

[Semantic Versioning](Semantic-Versioning.md) decides the bump. This policy
adds one rule with no exceptions: **a version that has ever been tagged or
uploaded is burned.**

PyPI permanently rejects any filename it has ever accepted, even after the
file is deleted, and deleted releases disappear from its JSON API. So a reused
version fails in the least visible way available — not with a clear conflict,
but with an upload that half-succeeds and an index that denies the evidence.
Never reuse a version; always bump past it.

## Publish-path gates

The publish path is gated as strongly as the merge path, and every control is
mechanical:

| control | mechanism |
| --- | --- |
| merge to `main` | the required status checks on the `Protect-Main` ruleset |
| tag shape | `scripts/create_release.py` derives the tag from `[project].version` and validates it against `TAG_RE` |
| release notes | the changelog's newest section, verbatim — nothing is authored at release time |
| publish enablement | the `PYPI_PUBLISH_ENABLED` repository variable, absent by default |
| PyPI upload | trusted publishing (OIDC) from the `pypi` environment; no long-lived token exists |
| filename availability | a pre-build guard queries PyPI and fails loud, naming the burned files, before anything is built |

## No release-time authorship

Some repositories have a model compose the release title and body. This one
does not, deliberately: the changelog is already the release notes, and adding
an authoring step adds an API dependency and a review surface to a step whose
job is to publish what has already been reviewed.

Traceability — merged pull requests, the compare link, the changelog anchor —
is computed from git and appended mechanically. Nothing in a release is
written at release time.

## Release deliverables

Every release carries:

- the wheel and sdist that PyPI serves
- GitHub build-provenance attestations for both, served by the attestation API
- SHA-256 digests of every artifact, in the publish run's job summary

Deliberately **not** produced: a CycloneDX SBOM, an offline
`provenance.intoto.jsonl` bundle, or release-attached asset files. Each is a
real capability and none is claimed here — a policy page that lists artifacts
the pipeline does not build sends a consumer looking for something that was
never there.

Consumers verify with:

```bash
gh attestation verify <artifact> --repo <owner>/<repo>
sha256sum <artifact>
```

## Recovery

Recovery from a partial release is asymmetric:

- **publish succeeded, assets missing** — re-run the asset step alone
- **upload failed partway** — the version is burned; bump past it

Never re-run the full workflow for a version PyPI already serves. The filename
guard will reject it, which is the design working.

## Read next

- [Making a Release](Making-Release.md)
- [Semantic Versioning](Semantic-Versioning.md)
- [Packaging](Packaging.md)
