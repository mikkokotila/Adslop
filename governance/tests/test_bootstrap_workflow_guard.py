"""Live bootstrap is explicit and consumes only reviewed main-branch configuration."""

from __future__ import annotations

import ast
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = REPO_ROOT / '.github/workflows/bootstrap_repository.yml'
BOOTSTRAP_SCRIPT = REPO_ROOT / 'governance/bootstrap_repository.py'


def _workflow() -> dict[str, object]:
    payload = yaml.safe_load(WORKFLOW.read_text(encoding='utf-8'))
    assert isinstance(payload, dict)
    return payload


def test_bootstrap_is_manual_only() -> None:
    payload = _workflow()
    triggers = payload.get('on', payload.get(True))
    assert isinstance(triggers, dict)
    assert set(triggers) == {'workflow_dispatch'}


def test_bootstrap_runs_only_from_main() -> None:
    jobs = _workflow()['jobs']
    assert isinstance(jobs, dict)
    job = jobs['bootstrap']
    assert isinstance(job, dict)
    assert job.get('if') == "github.ref == 'refs/heads/main'"


def test_bootstrap_has_no_repository_name_exclusion() -> None:
    text = WORKFLOW.read_text(encoding='utf-8')
    assert 'github.repository !=' not in text
    assert 'LABEL_TEMPLATE_REPOSITORY' not in text


def test_rename_engine_leaves_workflow_files_alone() -> None:
    tree = ast.parse(BOOTSTRAP_SCRIPT.read_text(encoding='utf-8'))
    skipping_branches = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.If)
        and _tests_for_workflows_prefix(node.test)
        and any(isinstance(stmt, ast.Continue) for stmt in node.body)
    ]
    assert skipping_branches, 'specialization must preserve reviewed workflow logic'


def _tests_for_workflows_prefix(test: ast.expr) -> bool:
    return any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == 'startswith'
        and any(
            isinstance(arg, ast.Constant) and arg.value == '.github/workflows/'
            for arg in node.args
        )
        for node in ast.walk(test)
    )
