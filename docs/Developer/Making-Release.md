# Making a release

The operational sequence. [Release Policy](Release-Policy.md) is the controls
this runs under; read that first if you are changing anything here.

## Prerequisites

- a merged PR on `main` that bumped `[project].version` and added the matching
  `CHANGELOG.md` section — the version gate requires both on every PR, so this
  is already true of any merge

## The sequence

There is no manual step. Merging to `main` runs `Automated Release`, which:

1. reads `[project].version` from `pyproject.toml`
2. derives the tag and validates it against `^v\d+\.\d+\.\d+$`
3. skips silently if that tag already exists — the step is idempotent
4. takes the changelog's newest section as the release notes
5. appends merged pull requests, the compare link and the changelog anchor
6. pushes the tag and creates the GitHub release

Publishing to PyPI is a separate workflow triggered by the release, and it
does nothing unless the repository variable `PYPI_PUBLISH_ENABLED` is `true`.

## Enabling PyPI publication

A derived repository publishes only after both of these exist:

1. a PyPI project with **trusted publishing** configured for this repository
   and the `pypi` GitHub environment
2. the repository variable `PYPI_PUBLISH_ENABLED` set to `true`

Until then the publish workflow is inert by design. A publish path that fires
by default is one that fires by accident.

## If something goes wrong

The release step is safe to re-run: an existing tag is a skip, not an error.

For a failed PyPI upload, read the recovery section of
[Release Policy](Release-Policy.md) — the two failure modes have different
answers, and choosing wrong burns a version.

## Read next

- [Release Policy](Release-Policy.md)
- [Packaging](Packaging.md)
