"""An already adopted repository remains intact and green after file bootstrap."""

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
_BOOTSTRAP = importlib.import_module('bootstrap_repository')
PROJECT_SLUG = _BOOTSTRAP._load_pyproject()['project']['name']
PROJECT_PACKAGE = _BOOTSTRAP._slug_to_package(PROJECT_SLUG)
_SEED_PACKAGE = 'new' + '_repository_' + 'template'
_IGNORE = shutil.ignore_patterns(
    '.git', '.venv*',
    '__pycache__', 'node_modules', '.pytest_cache', '.ruff_cache', 'htmlcov',
    '.hypothesis', 'build', '.docusaurus',
)
# `bootstrap_repository.py` names every placeholder because it is the thing
# that replaces them, and generated site output is rebuilt from sources that
# were themselves rewritten. Neither ships a placeholder to a reader.
_PLACEHOLDER_EXEMPT = ('governance/bootstrap_repository.py',)
# Selected by suffix rather than discovered by catching a decode error:
# the test-fallback gate forbids try/except in tests, and rightly -- a
# swallowed decode error would silently shrink what this test checks.
_TEXT_SUFFIXES = frozenset({
    '.py', '.md', '.yml', '.yaml', '.json', '.toml', '.txt', '.cff', '.cfg', '.ini',
})
# Placeholders the rename engine is responsible for filling in. Any survivor
# ships to the derived repository verbatim.
# Assembled, not written literally: this file is inside the rewrite sweep, so
# a literal placeholder here would be filled in and the check would stop
# looking for the thing it exists to find.
PLACEHOLDERS = tuple(
    '{' + name + '}'
    for name in ('REPOSITORY_NAME', 'DISPLAY_NAME', 'REPOSITORY_OWNER',
                 'ONE_SENTENCE_DESCRIPTION')
)


@pytest.fixture(scope='module')
def bootstrapped(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A copy of this adopted repository after the real idempotent CLI."""
    repo = tmp_path_factory.mktemp('adopted') / 'repo'
    shutil.copytree(REPO_ROOT, repo, ignore=_IGNORE)
    before = {
        path.relative_to(repo): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in repo.rglob('*') if path.is_file()
    }
    result = subprocess.run(
        [
            sys.executable, 'governance/bootstrap_repository.py', '--files-only',
            '--repo-name', PROJECT_SLUG, '--owner', 'mikkokotila',
        ],
        cwd=repo, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'already specialized' in result.stdout
    after = {
        path.relative_to(repo): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in repo.rglob('*') if path.is_file()
    }
    assert after == before, 'a repeated file bootstrap changed the adopted repository'
    return repo


def test_bootstrapped_repository_passes_its_own_suite(bootstrapped: Path) -> None:
    """A repeat bootstrap must preserve a working governance suite."""
    result = subprocess.run(
        [sys.executable, '-m', 'pytest', 'governance/tests', '-q', '-p', 'no:cacheprovider',
         '--deselect', 'governance/tests/test_bootstrapped_repo_is_green.py'],
        cwd=bootstrapped, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, (
        'a bootstrapped repository fails its own governance suite:\n'
        + result.stdout[-4000:] + result.stderr[-2000:]
    )


def test_preserved_budgets_fit_the_modules_they_budget(bootstrapped: Path) -> None:
    """The preserved budgets must still cover the adopted modules."""
    budgets = json.loads(
        (bootstrapped / '.github' / 'budgets.json').read_text(encoding='utf-8')
    )['modules']
    over: list[str] = []
    for rel, budget in budgets.items():
        path = bootstrapped / rel
        if not path.is_file():
            continue
        significant = sum(
            1 for line in path.read_text(encoding='utf-8').splitlines()
            if line.strip() and not line.strip().startswith('#')
        )
        if significant > budget:
            over.append(f'{rel}: {significant} lines vs budget {budget}')
    assert not over, 'preserved budgets smaller than the files they budget: ' + '; '.join(over)


def test_no_sha_pinned_file_is_rewritten_by_bootstrap(bootstrapped: Path) -> None:
    """The adopted repository retains its immutable-artifact checks."""
    result = subprocess.run(
        [sys.executable, '-m', 'pytest', 'governance/tests/test_agent_rulebook.py',
         '-q', '-p', 'no:cacheprovider'],
        cwd=bootstrapped, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, (
        'a SHA-pinned artifact was rewritten by bootstrap:\n' + result.stdout[-2000:]
    )


def test_no_placeholder_token_survives_bootstrap(bootstrapped: Path) -> None:
    """The adopted text files must contain no unresolved identity tokens."""
    survivors: list[str] = []
    for path in sorted(bootstrapped.rglob('*')):
        rel = path.relative_to(bootstrapped).as_posix()
        if not path.is_file() or rel in _PLACEHOLDER_EXEMPT:
            continue
        if any(part in {'.git', '__pycache__', 'node_modules', 'build',
                        '.docusaurus', '.hypothesis'} for part in path.parts):
            continue
        if path.suffix not in _TEXT_SUFFIXES:
            continue
        text = path.read_text(encoding='utf-8')
        for token in PLACEHOLDERS:
            if token in text:
                survivors.append(f'{rel}: {token}')
    assert not survivors, 'placeholders bootstrap left behind: ' + '; '.join(survivors)


def test_adopted_package_identity_is_preserved(bootstrapped: Path) -> None:
    """The test fixture really contains the adopted package and no seed."""
    assert (bootstrapped / PROJECT_PACKAGE).is_dir()
    assert not (bootstrapped / _SEED_PACKAGE).exists()
