# Packaging

The packaging contract: what the distributions contain, what they must never
contain, and what `pr_checks_packaging` proves about them.

## Prerequisites

- a clean checkout
- `python -m pip install -e ".[dev]"`
- `python -m pip install --require-hashes -r requirements/ci/packaging-tools.txt`

## Artifact policy

The **sdist** is the source-inspection bundle: the package, the public docs,
the tests, and the metadata a consumer needs to judge the project. It is
deliberately *not* a repository snapshot. The enforcement plane —
`governance/`, `.github/`, `fuzz/`, `docs-site/`, `scripts/` — is how this
repository is built, not something a consumer installs, and shipping it would
imply otherwise.

The **wheel** is the install artifact: runtime package files and package-level
docs. Tests are excluded.

`scripts/package_audit.py` enforces both directions — required paths present,
forbidden prefixes absent — because neither `twine check` (metadata only) nor
`check-manifest` (VCS-versus-sdist only) asserts what a consumer actually
receives.

## Dependency policy

Every declared dependency carries a lower **and** an upper bound, or an exact
`==` pin. An unbounded dependency lets a resolver silently change what ships
between two builds of the same version — the audit fails on it.

`requirements/constraints.txt` is the human-readable envelope the hash-pinned
`requirements/ci/*.txt` sets are compiled from. The compiled sets are what CI
installs; the envelope is what a reviewer reads.

## Reproducibility

Two builds of identical source must produce byte-identical artifacts:

```bash
SOURCE_DATE_EPOCH=1704067200 python -m build
```

The wheel is reproducible under stock setuptools. The **sdist is not** —
setuptools writes the current time into the gzip header and every tar member's
mtime, and orders members by directory walk. `build_backend.py` delegates to
setuptools and then rewrites the archive with a fixed epoch, sorted members,
and zeroed ownership.

That file must be listed in `MANIFEST.in`: `python -m build` builds the wheel
*from the sdist*, so the backend has to travel inside it.

Without this the reproducibility assertion would have to be weakened to the
wheel alone, leaving half of what a consumer audits unverified.

## Required proof

`pr_checks_packaging` runs, in order:

1. build twice under a fixed `SOURCE_DATE_EPOCH`
2. assert the two builds are byte-identical, and fail loudly if nothing built
3. `scripts/package_audit.py` — content and dependency-bound contract
4. `twine check`, `check-manifest`, `pyroma --min=9`
5. install the built wheel on every supported interpreter, import it from
   outside the checkout, and assert `__version__` agrees with distribution
   metadata

Step 5 imports from outside the checkout deliberately: importing inside it
would load the source tree and prove nothing about the wheel.

## Read next

- [Release Policy](Release-Policy.md)
- [Developer home](README.md)
