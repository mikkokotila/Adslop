# Adslop

Adslop is an API-first instrument for generating incremental revenue from digital products through systematic advertising experiments.

Its first product release will provide one campaign creation and management experience across Google and Meta, keyword-based targeting, conversion tracking, and unified performance measurement. Human and agent interfaces will use the same capabilities. Event sourcing, complete available provenance, experiment manifests, and reproducible releases form the foundation.

The initial operator is Mikko Kotila. The project begins as a private repository and is intended to develop into open-source software.

## Product specification

Read [the prose specification](SPECIFICATION.md) for the product requirements, execution and measurement behavior, and acceptance conditions.

The advertising engine has not yet been implemented. Meta's compatibility with the required keyword-targeting model remains an explicit capability dependency. Two-platform operation remains a first-release requirement.

## Current implementation

Version 0.1.0 establishes the repository foundation: a minimal importable Python package, governance gates, scoped issue and pull-request workflows, a documentation build, dependency locks, and release tooling. It does not connect to advertising accounts, collect conversion events, or spend money.

[SETUP.md](SETUP.md) records the GitHub activation procedure and the account prerequisites still outstanding. The checked-in protection policy requires independent review and passing checks. At initial adoption, GitHub refuses private-repository branch protection under the current account plan, both setup secrets are absent, and an independent reviewer has not been added. Committed policy is not evidence that server-side enforcement is active.

CodeQL follows the governance package's documented private-repository fallback. Its reactivation is tracked separately. Public package publication remains disabled, and no documentation site has been deployed.

## Local development

The canonical working directory is `~/dev/Adslop`.

Use Python 3.12 and the checked-in dependency locks:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python --require-hashes -r requirements/ci/dev-env.txt
uv pip install --python .venv/bin/python --require-hashes -r requirements/ci/runtime-env.txt
uv pip install --python .venv/bin/python --require-hashes -r requirements/ci/build-tools.txt
uv pip install --python .venv/bin/python --no-build-isolation --no-deps -e .
.venv/bin/python -m pytest tests/package governance/tests -q
.venv/bin/python -m ruff check adslop governance tests
```

The `adslop` import is only the package baseline. There is no campaign CLI or application server yet.

## Documentation

[The documentation index](docs/README.md) separates the current repository tools from the planned product. The full product contract remains in [SPECIFICATION.md](SPECIFICATION.md).

With Node.js 20 or newer:

```bash
npm --prefix docs-site ci
npm --prefix docs-site exec -- playwright install chromium
npm --prefix docs-site run security:audit
npm --prefix docs-site run check
npm --prefix docs-site start
```

Private GitHub links require authenticated repository access during validation. The documentation setup explains how to supply a narrowly scoped token through the environment.

## Contributing and governance

Read [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before changing the repository. Humans and agents follow the same issue, commit, verification, and review requirements.

Every delivery PR closes one open slice issue, stays within its declared file scope, uses a matching Conventional Commit title, and advances the version and changelog. The applicable required checks, written laws, and checked-in main ruleset must agree. Enforcement changes retain code-owner review and independent approval of the latest push.

## License

The adopted repository foundation uses the MIT license. See [LICENSE](LICENSE) for the permission terms and required copyright notice, and [THIRD_PARTY.md](THIRD_PARTY.md) for dependency information.
