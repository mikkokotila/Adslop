"""The label updater validates first, upserts locally declared labels, and never deletes."""

from __future__ import annotations

import importlib
import json
import types
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _module() -> types.ModuleType:
    return importlib.import_module('sync_labels')


def _label(name: str) -> dict[str, str]:
    labels = json.loads((REPO_ROOT / '.github/labels.json').read_text())
    return next(label for label in labels if label['name'] == name)


def _manifest(tmp_path: Path, labels: list[dict[str, str]]) -> Path:
    path = tmp_path / 'labels.json'
    path.write_text(json.dumps(labels), encoding='utf-8')
    return path


def test_upsert_updates_declared_labels_and_preserves_unrelated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    desired = [_label('slice'), _label('bug')]
    old_bug = {**_label('bug'), 'color': 'ffffff'}
    calls: list[tuple[list[str], dict[str, str] | None]] = []

    def run(args: list[str], *, body: dict[str, str] | None = None) -> str:
        calls.append((args, body))
        return json.dumps([[_label('support')], [old_bug]]) if body is None else '{}'

    monkeypatch.setattr(module, '_run_gh', run)
    assert module.sync_labels('mikkokotila/Adslop', _manifest(tmp_path, desired)) == 2
    assert calls[0][0] == [
        'api', '--paginate', '--slurp', 'repos/mikkokotila/Adslop/labels?per_page=100',
    ]
    assert [(args[2], body) for args, body in calls[1:]] == [
        ('POST', desired[0]),
        ('PATCH', {'new_name': 'bug', 'color': desired[1]['color'],
                   'description': desired[1]['description']}),
    ]
    assert all('DELETE' not in args and '/labels/support' not in args for args, _ in calls)


def test_invalid_last_label_prevents_every_github_operation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    calls: list[list[str]] = []
    monkeypatch.setattr(module, '_run_gh', lambda args: calls.append(args))
    path = _manifest(tmp_path, [_label('slice'), {**_label('bug'), 'color': 'invalid'}])
    with pytest.raises(SystemExit, match='invalid color'):
        module.sync_labels('mikkokotila/Adslop', path)
    assert calls == []


def test_duplicate_names_are_rejected_before_github(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    calls: list[list[str]] = []
    monkeypatch.setattr(module, '_run_gh', lambda args: calls.append(args))
    path = _manifest(tmp_path, [_label('slice'), {**_label('slice'), 'name': 'SLICE'}])
    with pytest.raises(SystemExit, match='duplicate'):
        module.sync_labels('mikkokotila/Adslop', path)
    assert calls == []


def test_existing_response_is_fully_validated_before_upsert(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    calls: list[list[str]] = []

    def run(args: list[str]) -> str:
        calls.append(args)
        return json.dumps([[_label('support')], [{'name': 'broken'}]])

    monkeypatch.setattr(module, '_run_gh', run)
    with pytest.raises(SystemExit, match='invalid color'):
        module.sync_labels('mikkokotila/Adslop', _manifest(tmp_path, [_label('slice')]))
    assert len(calls) == 1


def test_matching_labels_are_idempotent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    desired = [_label('slice')]
    calls: list[list[str]] = []

    def run(args: list[str]) -> str:
        calls.append(args)
        return json.dumps([[*desired, _label('support')]])

    monkeypatch.setattr(module, '_run_gh', run)
    assert module.sync_labels('mikkokotila/Adslop', _manifest(tmp_path, desired)) == 0
    assert len(calls) == 1


def test_dry_run_never_mutates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    calls: list[list[str]] = []

    def run(args: list[str]) -> str:
        calls.append(args)
        return '[[]]'

    monkeypatch.setattr(module, '_run_gh', run)
    assert module.sync_labels(
        'mikkokotila/Adslop', _manifest(tmp_path, [_label('slice')]), dry_run=True,
    ) == 1
    assert len(calls) == 1


def test_default_manifest_comes_from_governance_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = _module()
    expected = [_label('slice')]
    (tmp_path / 'chosen.json').write_text(json.dumps(expected))
    (tmp_path / 'governance.yml').write_text('bootstrap:\n  labels_manifest: chosen.json\n')
    monkeypatch.setattr(module, 'REPO_ROOT', tmp_path)
    assert module.load_labels() == expected


def test_repository_manifest_is_normalized() -> None:
    labels = _module().load_labels()
    assert {'slice', 'planning', 'bug', 'support'} <= {label['name'] for label in labels}
    assert all(label['color'] == label['color'].lower() for label in labels)
