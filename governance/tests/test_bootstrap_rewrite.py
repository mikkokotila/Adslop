"""Bootstrap keeps repository identity separate from Python import identity."""

from __future__ import annotations

import hashlib
import importlib
import json
import types
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]


def _bootstrap() -> types.ModuleType:
    return importlib.import_module('bootstrap_repository')


def _seed_repository(root: Path) -> str:
    seed = sorted(_bootstrap().KNOWN_SEED_PACKAGES)[0]
    package = root / seed
    package.mkdir()
    (package / '__init__.py').write_text(
        f'"""Public package surface for {seed.replace("_", "-")}."""\n\n'
        '__all__: list[str] = []\n', encoding='utf-8',
    )
    (root / 'pyproject.toml').write_text(
        f'[project]\nname = "{seed.replace("_", "-")}"\nversion = "0.1.0"\n'
        f'[tool.pyright]\ninclude = ["{seed}"]\n', encoding='utf-8',
    )
    (root / 'governance.yml').write_text(
        f'layout:\n  package_root: {seed}\n  coverage_source: {seed}\n',
        encoding='utf-8',
    )
    (root / 'profile.json').write_text(json.dumps({
        'name': '{' + 'REPOSITORY_NAME}',
        'source': 'https://github.com/{' + 'REPOSITORY_OWNER}/{' + 'REPOSITORY_NAME}',
        'package': seed,
    }), encoding='utf-8')
    workflow = root / '.github/workflows/example.yml'
    workflow.parent.mkdir(parents=True)
    workflow.write_text(f'name: {seed}\n', encoding='utf-8')
    return seed


def _tree_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob('*'))
        if path.is_file() and '__pycache__' not in path.parts
    }


@pytest.mark.parametrize(('slug', 'package'), [
    ('Adslop', 'adslop'),
    ('My-New-App', 'my_new_app'),
    ('class', 'class_pkg'),
])
def test_mixed_case_identity_is_not_rewritten_twice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, slug: str, package: str,
) -> None:
    seed = _seed_repository(tmp_path)
    module = _bootstrap()
    monkeypatch.setattr(module, 'REPO_ROOT', tmp_path)
    module._apply_file_bootstrap(slug, package, 'mikkokotila')

    assert (tmp_path / package / '__init__.py').is_file()
    assert not (tmp_path / seed).exists()
    assert f'name = "{slug}"' in (tmp_path / 'pyproject.toml').read_text()
    layout = yaml.safe_load((tmp_path / 'governance.yml').read_text())['layout']
    assert layout == {'package_root': package, 'coverage_source': package}
    assert json.loads((tmp_path / 'profile.json').read_text()) == {
        'name': slug, 'source': f'https://github.com/mikkokotila/{slug}', 'package': package,
    }
    assert f"import_module('{package}')" in (tmp_path / 'tests/package/test_import.py').read_text()
    assert (tmp_path / '.github/workflows/example.yml').read_text() == f'name: {seed}\n'


def test_file_bootstrap_preserves_calibrated_state_on_repeat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_repository(tmp_path)
    module = _bootstrap()
    monkeypatch.setattr(module, 'REPO_ROOT', tmp_path)
    module._apply_file_bootstrap('Adslop', 'adslop', 'mikkokotila')
    budget_path = tmp_path / '.github/budgets.json'
    budgets = json.loads(budget_path.read_text())
    budgets['modules']['adslop/__init__.py'] = 999
    budget_path.write_text(json.dumps(budgets))
    before = _tree_hashes(tmp_path)

    module._apply_file_bootstrap('Adslop', 'adslop', 'mikkokotila')

    assert _tree_hashes(tmp_path) == before
