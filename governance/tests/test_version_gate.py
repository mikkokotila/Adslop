from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from governance import version_gate


def _pyproject(version: str) -> str:
    return f'[project]\nname = "demo"\nversion = "{version}"\n'


def _changelog(version: str, body: str = '- Change.\n') -> str:
    return f'# v{version}\n\n{body}\n# v1.2.3\n\n- Previous.\n'


def test_gate_accepts_feat_with_minor_bump_and_changelog_content() -> None:
    failures = version_gate.gate(
        'feat: add law template',
        _pyproject('1.2.3'),
        _pyproject('1.3.0'),
        _changelog('1.2.3'),
        _changelog('1.3.0'),
    )
    assert failures == []


def test_gate_rejects_feat_with_patch_bump() -> None:
    failures = version_gate.gate(
        'feat: add law template',
        _pyproject('1.2.3'),
        _pyproject('1.2.4'),
        _changelog('1.2.3'),
        _changelog('1.2.4'),
    )
    assert any('requires at least a minor version bump' in item for item in failures)


def test_gate_requires_new_changelog_header_at_top() -> None:
    failures = version_gate.gate(
        'fix: tighten law template',
        _pyproject('1.2.3'),
        _pyproject('1.2.4'),
        _changelog('1.2.3'),
        '# v1.2.3\n\n- Previous.\n\n# v1.2.4\n\n- New but misplaced.\n',
    )
    assert any('top version header is `# v1.2.3`' in item for item in failures)


def test_gate_rejects_empty_top_changelog_section() -> None:
    failures = version_gate.gate(
        'fix: tighten law template',
        _pyproject('1.2.3'),
        _pyproject('1.2.4'),
        _changelog('1.2.3'),
        '# v1.2.4\n\n# v1.2.3\n\n- Previous.\n',
    )
    assert any('has no content before the next version header' in item for item in failures)


def test_strict_semver_rejects_prerelease_versions() -> None:
    with pytest.raises(SystemExit) as exc:
        version_gate.parse_semver('1.2.4-alpha')
    assert exc.value.code == 2


def test_gate_rejects_past_tense_changelog_bullet() -> None:
    failures = version_gate.gate(
        'fix: tighten law template',
        _pyproject('1.2.3'),
        _pyproject('1.2.4'),
        _changelog('1.2.3'),
        _changelog('1.2.4', body='- Added a new helper.\n'),
    )
    assert any('past tense' in item for item in failures)


def test_gate_rejects_changelog_placeholder() -> None:
    failures = version_gate.gate(
        'fix: tighten law template',
        _pyproject('1.2.3'),
        _pyproject('1.2.4'),
        _changelog('1.2.3'),
        _changelog('1.2.4', body='- Fix the parser (TODO: expand later).\n'),
    )
    assert any('placeholder' in item for item in failures)


def test_gate_accepts_imperative_changelog_bullet() -> None:
    failures = version_gate.gate(
        'fix: tighten law template',
        _pyproject('1.2.3'),
        _pyproject('1.2.4'),
        _changelog('1.2.3'),
        _changelog('1.2.4', body='- Fix the broken parser path.\n'),
    )
    assert failures == []


def test_header_form_whitespace_survives_next_to_the_placeholder() -> None:
    """Whitespace adjacent to `{version}` must become flexible whitespace.

    Splitting the literal on spaces and dropping empty chunks deleted the run
    either side of the placeholder, so `## {version}` compiled to a pattern
    demanding the version immediately after `##`. A repository configured that
    way matched none of its own headers and the gate reported a missing
    changelog header on every PR.
    """
    import re as _re

    for form in ('# v{version}', '## {version}', '## Version {version}',
                 '## [{version}] - ', '### v{version}:'):
        before, _, after = form.partition('{version}')
        pattern = '^' + version_gate._escape_form(before) + version_gate._VERSION_TOKEN
        pattern += version_gate._escape_form(after) if after.strip() else r'\b'
        sample = form.replace('{version}', '1.2.3')
        assert _re.match(pattern, sample), f'{form!r} does not match its own header {sample!r}'


def _git(repository: Path, *arguments: str) -> str:
    """Build real test history without inheriting user hooks or signing settings."""
    return subprocess.run(
        ['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
         '-c', 'user.name=Version gate tests', '-c', 'user.email=version-gate@example.invalid',
         *arguments],
        cwd=repository, text=True, capture_output=True, check=True,
    ).stdout.strip()


@pytest.fixture
def repository(tmp_path: Path) -> Path:
    _git(tmp_path, 'init', '--quiet')
    _git(tmp_path, 'symbolic-ref', 'HEAD', 'refs/heads/main')
    return tmp_path


def _commit(repository: Path, files: dict[str, str | None]) -> str:
    for name, content in files.items():
        path = repository / name
        if content is None:
            path.unlink()
        else:
            path.write_text(content, encoding='utf-8')
    _git(repository, 'add', '-A')
    _git(repository, 'commit', '--quiet', '--allow-empty', '-m', 'test: record version evidence')
    return _git(repository, 'rev-parse', 'HEAD')


def _artifacts(version: str = '0.1.0') -> dict[str, str | None]:
    return {
        'pyproject.toml': _pyproject(version),
        'CHANGELOG.md': f'# v{version}\n\n- Introduce the project.\n',
    }


@pytest.mark.parametrize('version', ['0.0.0', '0.1.0', '2.4.6'])
def test_initial_version_uses_committed_additions_without_a_fake_base(
    repository: Path, capsys: pytest.CaptureFixture[str], version: str,
) -> None:
    base = _commit(repository, {'README.md': '# Project\n'})
    _commit(repository, _artifacts(version))

    assert version_gate.gate_from_git('feat: introduce governance', base, repository) == []
    assert 'VERSION GATE -- INITIAL VERSION' in capsys.readouterr().out


@pytest.mark.parametrize(
    'version',
    ['01.2.3', '1.02.3', '1.2.03', '\u0661.2.3', '1.2.3+build', '1.2.3-rc.1',
     ' 1.2.3', '1.2.3 ', '1.2.3\n', '1.2'],
)
def test_semver_rejects_noncanonical_numeric_triples(version: str) -> None:
    with pytest.raises(SystemExit) as exc:
        version_gate.parse_semver(version)
    assert exc.value.code == 2


@pytest.mark.parametrize(
    'project',
    [_pyproject('01.0.0'), '[project]\nname = "demo"\n',
     '[project]\nversion = 1\n', '[project\nversion = "0.1.0"\n'],
)
def test_initial_version_validates_the_real_project_version(
    repository: Path, project: str,
) -> None:
    base = _commit(repository, {'README.md': '# Project\n'})
    _commit(repository, {**_artifacts(), 'pyproject.toml': project})

    with pytest.raises(SystemExit) as exc:
        version_gate.gate_from_git('feat: introduce governance', base, repository)
    assert exc.value.code == 2


@pytest.mark.parametrize(
    ('changelog', 'failure'),
    [
        ('# v0.2.0\n\n- Introduce governance.\n', 'newest header must match'),
        ('- Introduce governance.\n', 'contains no'),
        ('# v0.1.0\n\n', 'has no content'),
        ('# v0.1.0\n\n## Changes\n', 'has no content'),
        ('# v0.1.0\n\n- TBD\n', 'placeholder'),
        ('# v0.1.0\n\nTODO\n', 'placeholder'),
        ('# v0.1.0\n\n- Added governance.\n', 'past tense'),
    ],
)
def test_initial_version_requires_matching_substantive_release_notes(
    repository: Path, changelog: str, failure: str,
) -> None:
    base = _commit(repository, {'README.md': '# Project\n'})
    _commit(repository, {**_artifacts(), 'CHANGELOG.md': changelog})

    failures = version_gate.gate_from_git('feat: introduce governance', base, repository)
    assert any(failure in item for item in failures)


@pytest.mark.parametrize('present', ['pyproject.toml', 'CHANGELOG.md'])
def test_partial_baseline_cannot_enter_initial_version_mode(
    repository: Path, present: str,
) -> None:
    artifacts = _artifacts()
    base = _commit(repository, {present: artifacts[present]})
    _commit(repository, artifacts)

    failures = version_gate.gate_from_git('feat: introduce governance', base, repository)
    assert any('partial version baseline' in item for item in failures)


@pytest.mark.parametrize('present', [None, 'pyproject.toml', 'CHANGELOG.md'])
def test_initial_version_requires_both_artifacts_in_the_head_commit(
    repository: Path, present: str | None,
) -> None:
    base = _commit(repository, {'README.md': '# Project\n'})
    artifacts = _artifacts()
    _commit(repository, {} if present is None else {present: artifacts[present]})

    failures = version_gate.gate_from_git('feat: introduce governance', base, repository)
    assert any('head commit is missing required artifacts' in item for item in failures)


@pytest.mark.parametrize('deleted', ['pyproject.toml', 'CHANGELOG.md'])
def test_deleting_an_existing_artifact_fails_instead_of_becoming_an_introduction(
    repository: Path, deleted: str,
) -> None:
    base = _commit(repository, _artifacts())
    _commit(repository, {deleted: None})

    failures = version_gate.gate_from_git('fix: revise governance', base, repository)
    assert any('head commit is missing required artifacts' in item for item in failures)


def test_uncommitted_artifacts_do_not_prove_initial_version_eligibility(repository: Path) -> None:
    base = _commit(repository, {'README.md': '# Project\n'})
    for name, content in _artifacts().items():
        assert content is not None
        (repository / name).write_text(content, encoding='utf-8')

    failures = version_gate.gate_from_git('feat: introduce governance', base, repository)
    assert any('head commit is missing required artifacts' in item for item in failures)


def test_unreadable_base_fails_setup_instead_of_appearing_empty(repository: Path) -> None:
    _commit(repository, _artifacts())

    with pytest.raises(SystemExit) as exc:
        version_gate.gate_from_git('feat: introduce governance', 'missing-base', repository)
    assert exc.value.code == 2


def test_nonancestor_base_cannot_grant_initial_version_mode(repository: Path) -> None:
    base = _commit(repository, {'README.md': '# Project\n'})
    unrelated = _git(repository, 'commit-tree', f'{base}^{{tree}}', '-m', 'Unrelated base')
    _commit(repository, _artifacts())

    with pytest.raises(SystemExit) as exc:
        version_gate.gate_from_git('feat: introduce governance', unrelated, repository)
    assert exc.value.code == 2


@pytest.mark.parametrize(
    ('title', 'version', 'failure'),
    [
        ('fix: rename the project', '1.2.4', None),
        ('feat: rename the project', '1.2.4', 'requires at least a minor version bump'),
        ('chore: rename the project', '1.2.3', 'Every PR must bump the version'),
    ],
)
def test_established_project_rename_keeps_ordinary_comparison_rules(
    repository: Path, capsys: pytest.CaptureFixture[str],
    title: str, version: str, failure: str | None,
) -> None:
    base = _commit(repository, _artifacts('1.2.3'))
    _commit(repository, {
        'pyproject.toml': _pyproject(version).replace('demo', 'renamed'),
        'CHANGELOG.md': f'# v{version}\n\n- Rename the project.\n',
    })

    failures = version_gate.gate_from_git(title, base, repository)
    if failure is None:
        assert failures == []
    else:
        assert any(failure in item for item in failures)
    output = capsys.readouterr().out
    assert 'VERSION GATE -- COMPARISON' in output
    assert 'INITIAL VERSION' not in output
