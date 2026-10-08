# Third-Party Notices

Adslop depends on Python and JavaScript open source packages declared in:

- `pyproject.toml`
- `requirements/ci/*.in` and their compiled, hash-pinned `*.txt` sets
- `docs-site/package.json`
- `docs-site/package-lock.json`

Dependency license review is required before release when dependencies are added, removed, or materially upgraded.

## Current Known Notes

- The template declares no runtime dependencies, so `pr_checks_lint`'s dependency-vulnerability gate is a vacuous pass until a derived repository declares some.
- Docusaurus may retain upstream moderate advisories until its dependency chain releases fixed versions. `docs-site` runs `npm audit --omit=dev` and treats high severity as blocking.
