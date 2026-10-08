# Semantic versioning

How to decide the bump, and every surface that must carry the result.

## Prerequisites

- the change's public compatibility impact
- the current version, changelog, and citation metadata

## Version surfaces

| surface | role |
| --- | --- |
| `pyproject.toml` | the canonical version for builds and releases |
| `CHANGELOG.md` | the human-readable history; its newest section becomes the release notes |
| `CITATION.cff` | citation version and release date |
| git tag `v<version>` | the release identity `scripts/create_release.py` derives |

## Rules

- **MAJOR** — an incompatible change to the public API, CLI, schema, or
  package contract
- **MINOR** — a new compatible capability
- **PATCH** — a compatible fix, docs correction, metadata correction, or
  dependency refresh

The version gate enforces a minimum from the PR's Conventional Commits type:
`type!` requires major, `feat` requires minor, everything else at least patch.
A larger bump than the minimum is always allowed.

**Every ordinary PR bumps the version and adds a changelog section**, including
docs-only PRs. The explicit dependency-bot exemption is defined in
`governance.yml` and disclosed by [CLAUDE.md](../../CLAUDE.md); it must not be
expanded through an undocumented exception.

## Read next

- [Release Policy](Release-Policy.md)
- [Making a Release](Making-Release.md)
