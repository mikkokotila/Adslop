"""The bootstrap file rewrite renames the package but preserves the template slug.

References to the template's own slug (`mikkokotila/Adslop`) -- the
README provenance link, the SETUP runbook's `--template` command, the label
source -- must survive specialization unchanged, even though every other
occurrence of the seed package name is rewritten.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _seed_packages() -> frozenset[str]:
    # Read the seed names from the bootstrap module rather than a string
    # literal: the bootstrap rewrites the seed package name everywhere it
    # appears EXCEPT its own KNOWN_SEED_PACKAGES constant, so a literal here
    # would be rewritten to the new package name in a specialized repo and
    # the guard would misfire. The constant is the one rewrite-proof source.
    # governance/ is on sys.path via governance/tests/conftest.py.
    return importlib.import_module('bootstrap_repository').KNOWN_SEED_PACKAGES


# These tests exercise the seed-package rename, which only happens on the
# template itself. In an already-specialized repository (a bootstrapped repo
# running its own copy of the suite) there is no seed package to rename, and
# the idempotency guard makes the rewrite a no-op -- so there is nothing for
# these tests to assert. Skip them there, exactly as the CodeQL-fallback
# tests skip once CodeQL has been removed.
_HAS_SEED = any((REPO_ROOT / seed).is_dir() for seed in _seed_packages())
_requires_seed = pytest.mark.skipif(
    not _HAS_SEED,
    reason='no seed package present; repository already specialized',
)

_IGNORE = shutil.ignore_patterns(
    '.git', '.venv', '.venv-lint', '.venv-ruleset', '.venv-ruleset-audit',
    '__pycache__', '.pytest_cache', '.ruff_cache',
)


def _tree_hashes(root: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for path in sorted(root.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            out[str(path.relative_to(root))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


@_requires_seed
def test_template_slug_survives_file_bootstrap(tmp_path: Path) -> None:
    repo = tmp_path / 'repo'
    shutil.copytree(REPO_ROOT, repo, ignore=_IGNORE)
    result = subprocess.run(
        [
            sys.executable, 'governance/bootstrap_repository.py', '--files-only',
            '--repo-name', 'my-new-app', '--owner', 'Adslop',
        ],
        cwd=repo,
        check=False,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr + result.stdout

    # The rewrite actually ran: the seed package is renamed and gone.
    assert (repo / 'my_new_app').is_dir()
    assert not (repo / 'Adslop').exists()
    assert 'Adslop' not in (repo / 'pyproject.toml').read_text(encoding='utf-8')

    # ...but references to the template's own slug are preserved verbatim.
    readme = (repo / 'README.md').read_text(encoding='utf-8')
    assert 'https://github.com/mikkokotila/Adslop' in readme
    setup = (repo / 'SETUP.md').read_text(encoding='utf-8')
    assert '--template mikkokotila/Adslop' in setup
    docs_profile = json.loads(
        (repo / 'docs-site' / 'product-docs.json').read_text(encoding='utf-8')
    )
    assert docs_profile == {
        'productId': 'my-new-app',
        'productName': 'My New App',
        'tagline': 'Python package with repository law built in.',
        'siteUrl': 'https://docs.adslop.fi',
        'basePath': '/my-new-app/',
        'sourceRepoUrl': 'https://github.com/Adslop/my-new-app',
    }


@_requires_seed
def test_file_bootstrap_is_idempotent(tmp_path: Path) -> None:
    # The bootstrap workflow triggers on every push to main, so the rewrite
    # must be a no-op once the repository is already specialized -- otherwise
    # every later merge re-runs it and opens a spurious bootstrap PR.
    repo = tmp_path / 'repo'
    shutil.copytree(REPO_ROOT, repo, ignore=_IGNORE)
    cmd = [
        sys.executable, 'governance/bootstrap_repository.py', '--files-only',
        '--repo-name', 'my-new-app', '--owner', 'Adslop',
    ]
    first = subprocess.run(cmd, cwd=repo, check=False, capture_output=True, text=True)
    assert first.returncode == 0, first.stderr + first.stdout
    assert (repo / 'my_new_app').is_dir()

    # Tune a module budget the way a real slice does -- the exact value the
    # un-guarded re-run used to revert, opening a spurious bootstrap PR.
    budget_path = repo / '.github' / 'budgets.json'
    budgets = json.loads(budget_path.read_text(encoding='utf-8'))
    budgets['modules']['my_new_app/__init__.py'] = 999
    budget_path.write_text(json.dumps(budgets, indent=2) + '\n', encoding='utf-8')

    before = _tree_hashes(repo)
    second = subprocess.run(cmd, cwd=repo, check=False, capture_output=True, text=True)
    assert second.returncode == 0, second.stderr + second.stdout
    assert 'already specialized' in second.stdout
    assert _tree_hashes(repo) == before, 'second bootstrap run must change nothing'
    # The tuned budget survived: the re-run did not regenerate it.
    reread = json.loads(budget_path.read_text(encoding='utf-8'))
    assert reread['modules']['my_new_app/__init__.py'] == 999
