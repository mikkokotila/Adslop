from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP_WORKFLOW = REPO_ROOT / '.github/workflows/bootstrap_repository.yml'
LINT_WORKFLOW = REPO_ROOT / '.github/workflows/pr_checks_lint.yml'
RULESET_WORKFLOW = REPO_ROOT / '.github/workflows/pr_checks_ruleset.yml'
TYPING_WORKFLOW = REPO_ROOT / '.github/workflows/pr_checks_typing.yml'
VERSION_WORKFLOW = REPO_ROOT / '.github/workflows/pr_checks_version.yml'
FAIL_LOUD_WORKFLOW = REPO_ROOT / '.github/workflows/pr_checks_fail_loud.yml'
BOOTSTRAP_SCRIPT = REPO_ROOT / 'governance/bootstrap_repository.py'


def test_bootstrap_only_applies_committed_main_configuration() -> None:
    workflow = BOOTSTRAP_WORKFLOW.read_text(encoding='utf-8')

    assert 'REPO_BOOTSTRAP_TOKEN is required' in workflow
    assert "if: github.ref == 'refs/heads/main'" in workflow
    assert 'ref: main' in workflow
    assert '--github-only' in workflow
    assert '--files-only' not in workflow
    assert '--codeql' not in workflow
    assert 'gh pr create' not in workflow
    assert 'gh pr merge' not in workflow
    assert 'git push' not in workflow
    assert '--admin' not in workflow
    assert 'bypass_actors' not in workflow


def test_bootstrap_reads_target_identity_through_environment() -> None:
    workflow = BOOTSTRAP_WORKFLOW.read_text(encoding='utf-8')

    assert '--repo-name "$REPOSITORY_NAME"' in workflow
    assert '--owner "$REPOSITORY_OWNER"' in workflow
    assert 'inputs.package_name' not in workflow


def test_bootstrap_job_has_timeout() -> None:
    workflow = BOOTSTRAP_WORKFLOW.read_text(encoding='utf-8')

    assert 'timeout-minutes: 30' in workflow


def test_bootstrap_serializes_concurrent_runs() -> None:
    workflow = BOOTSTRAP_WORKFLOW.read_text(encoding='utf-8')

    assert 'concurrency:' in workflow
    assert 'group: ${{ github.workflow }}' in workflow
    # Do not cancel one live label/ruleset reconciliation halfway through.
    assert 'cancel-in-progress: false' in workflow
    assert 'cancel-in-progress: true' not in workflow


def test_initial_specialization_uses_bootstrap_modes() -> None:
    """The one-shot probe must test a fact that is actually one-shot.

    It used to be `base == "<the template's own name>" and head == repo`,
    which is permanently true *in* the template -- so the version gate exited
    0 before running and both ratchets sat in bootstrap mode on every PR here.
    Comparing base to head asks the question the probe wanted: does this PR
    rename the project? False on every ordinary PR anywhere, true exactly
    once in a derived repository.
    """
    source_template = 'new' '-repository-template'
    for workflow in (
        RULESET_WORKFLOW,
        TYPING_WORKFLOW,
        FAIL_LOUD_WORKFLOW,
    ):
        text = workflow.read_text(encoding='utf-8')
        # All three conditions. The original probe was `base == <seed> and
        # head == repo`, permanently true in the template. Dropping the seed
        # test entirely fixed that but made any rename a bypass, so the probe
        # now needs the base to still be the seed, the name to change, and the
        # repository not to be the template -- true exactly once, in a derived
        # repository's bootstrap PR.
        assert f'base == "{source_template}"' in text, workflow.name
        assert 'base != head' in text, workflow.name
        assert f'repo != "{source_template}"' in text, workflow.name


def test_version_workflow_always_validates_committed_artifacts() -> None:
    workflow = yaml.safe_load(VERSION_WORKFLOW.read_text(encoding='utf-8'))
    steps = workflow['jobs']['pr_checks_version']['steps']
    gate_steps = [step for step in steps if 'python governance/version_gate.py' in step.get('run', '')]
    assert len(gate_steps) == 1
    step = gate_steps[0]
    assert 'if' not in step
    assert step['env']['BASE_SHA'] == '${{ github.event.pull_request.base.sha }}'
    assert '--base-ref "$BASE_SHA"' in step['run']
    assert 'exit 0' not in step['run']


def test_lint_workflow_has_no_template_package_root() -> None:
    workflow = LINT_WORKFLOW.read_text(encoding='utf-8')

    source_package = 'new' + '_repository_' + 'template'
    assert source_package not in workflow
    assert 'steps.package.outputs.package_root' in workflow


def test_ruleset_lookup_ignores_organization_rulesets() -> None:
    script = BOOTSTRAP_SCRIPT.read_text(encoding='utf-8')

    assert "item.get('source_type') == 'Repository'" in script


def test_bootstrap_rewrite_leaves_workflow_files_static() -> None:
    script = BOOTSTRAP_SCRIPT.read_text(encoding='utf-8')

    assert "rel_path.startswith('.github/workflows/')" in script
    assert 'changed += _write_workflows(package_name)' not in script
    for dead_name in (
        '_lint_workflow',
        '_honesty_workflow',
        '_typing_workflow',
        '_deploy_workflow',
        '_bootstrap_workflow',
        '_write_workflows',
    ):
        assert f'def {dead_name}' not in script


def test_private_scorecard_does_not_publish_and_guards_sarif_upload() -> None:
    workflow = (REPO_ROOT / '.github/workflows/scorecard-analysis.yml').read_text()
    assert 'publish_results: false' in workflow
    assert 'publish_results: true' not in workflow
    assert 'id-token: write' not in workflow
    assert "if: steps.sarif.outputs.enabled == 'true'" in workflow
    assert 'security_and_analysis.code_security.status' in workflow


def test_label_workflows_share_the_local_manifest_updater() -> None:
    workflow = (REPO_ROOT / '.github/workflows/copy-standard-labels.yml').read_text()
    assert 'python governance/sync_labels.py --repo "$REPOSITORY"' in workflow
    assert 'LABEL_TEMPLATE_REPOSITORY' not in workflow
    assert 'DELETE' not in workflow
