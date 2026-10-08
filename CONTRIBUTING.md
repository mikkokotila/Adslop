# Contributing

Read [CLAUDE.md](CLAUDE.md), [PR_GUIDELINE.md](PR_GUIDELINE.md), and [REPO_SPECIFICS.md](REPO_SPECIFICS.md) before contributing. The constitution defines the laws, workflow, and code stance. For repository activation, follow [SETUP.md](SETUP.md).

## Local setup

Use Python 3.12 and Node.js 20 or later. Install the checked-in dependency sets so local tools match the declared CI toolchain.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements/ci/dev-env.txt
python -m pip install --require-hashes -r requirements/ci/runtime-env.txt
python -m pip install --require-hashes -r requirements/ci/build-tools.txt
python -m pip install --no-build-isolation --no-deps -e .
npm --prefix docs-site ci
npm --prefix docs-site exec -- playwright install chromium
```

## Contribution workflow

Start with an open slice issue and branch from `main`. Push the first working increment and open a non-draft PR before running local gates. Read the full PR diff yourself, then request an eligible independent reviewer as the constitution requires. Continue local validation while CI runs.

The core local checks are:

```bash
python -m pytest tests/package -q --maxfail=1
python -m pytest governance/tests -q
python -m ruff check adslop governance tests
python governance/check_module_budgets.py
python governance/check_module_docstrings.py
python governance/check_docstrings.py
npm --prefix docs-site run security:audit
npm --prefix docs-site run check
```

These commands complement the workflow checks; they do not replace the ratchets, coverage checks, vulnerability checks, or live-ruleset comparison that CI performs. Read the failing workflow output and fix its stated cause.

Every ordinary PR increases `[project].version` and adds an imperative `CHANGELOG.md` entry under the matching new version header. Documentation-only changes are included. For an initial adoption, the version gate verifies that both artifacts are absent on the committed ancestor PR base and that the PR adds both; it then validates the initial canonical numeric version and substantive matching changelog. A partial baseline is an error. This introduction path runs the gate and does not manufacture a historical version. Only the dependency-bot exemptions explicitly configured in `governance.yml` may skip the slice and version gates.

## Merge and review

All laws in [CLAUDE.md](CLAUDE.md) remain binding. A wrong gate is corrected through its own governed change; it is not worked around in the capability PR.

The shared review brief is [.github/copilot-instructions.md](.github/copilot-instructions.md). Resolve review threads, confirm the exact PR head passes the required checks, and keep the branch current before merge. [MAINTAINERS.md](MAINTAINERS.md) explains review eligibility. Do not claim protected merge readiness until [SETUP.md](SETUP.md)'s live activation requirements are satisfied.
