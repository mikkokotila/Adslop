#!/usr/bin/env python3
"""Validate a release version and its changelog against committed evidence.

Ordinary PRs change both artifacts, advance strict MAJOR.MINOR.PATCH, meet the
Conventional Commits bump minimum, and add a matching nonempty, imperative,
non-placeholder changelog section. Historical sections are not re-litigated.

Initial-version mode is derived from Git, never requested as a bypass: both
artifacts must be absent at a verified ancestor base and added by the PR.
The first version and its changelog receive the same head validation, without
inventing a previous version or an increment from one.

CI usage: python governance/version_gate.py --pr-title "feat: add capability"
    --base-ref <verified-PR-base-commit> --pr-author <PR-author>
Artifact callers may instead supply --base-pyproject, --head-pyproject,
--base-changelog, and --head-changelog; that path always compares versions.
Exit 0 means pass, 1 means a failed rule, and 2 means invalid input or setup.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from typing import Final

from _common import (
    CC_RE,
    TOMLDecodeError,
    exit_if_bot_exempt,
    exit_if_disabled,
    fail_setup,
    loads_toml,
    section_setting,
)

# Strict `MAJOR.MINOR.PATCH` only. We explicitly reject prerelease
# and build-metadata forms because this gate compares as integer
# triples; accepting `1.3.1-alpha` but silently ignoring the `-alpha`
# part would let `1.3.1-alpha` and `1.3.1` compare equal. The simpler
# fix is to refuse ambiguous forms outright.
SEMVER_RE: Final[re.Pattern[str]] = re.compile(
    r'(?P<major>0|[1-9][0-9]*)\.(?P<minor>0|[1-9][0-9]*)\.(?P<patch>0|[1-9][0-9]*)'
)


LEVEL_ORDER: Final[dict[str, int]] = {
    'none': 0,
    'patch': 1,
    'minor': 2,
    'major': 3,
}


def parse_semver(value: str) -> tuple[int, int, int]:
    """Accept canonical numeric SemVer without prerelease or build metadata."""
    match = SEMVER_RE.fullmatch(value)
    if match is None:
        print(
            f'version_gate: {value!r} is not a valid version string. '
            f'Expected strict `MAJOR.MINOR.PATCH` (no prerelease, no '
            f'build metadata).',
            file=sys.stderr,
        )
        raise SystemExit(2)
    return int(match['major']), int(match['minor']), int(match['patch'])


def extract_version(pyproject_text: str, label: str) -> str:
    try:
        data = loads_toml(pyproject_text)
    except TOMLDecodeError as exc:
        print(
            f'version_gate: cannot parse {label} pyproject.toml: {exc}',
            file=sys.stderr,
        )
        raise SystemExit(2) from exc
    project = data.get('project')
    if not isinstance(project, dict):
        print(
            f'version_gate: {label} pyproject.toml has no [project] table',
            file=sys.stderr,
        )
        raise SystemExit(2)
    version = project.get('version')
    if not isinstance(version, str) or not version.strip():
        print(
            f'version_gate: {label} pyproject.toml [project].version is missing '
            f'or not a string (got {version!r})',
            file=sys.stderr,
        )
        raise SystemExit(2)
    return version


def bump_level(base: tuple[int, int, int], head: tuple[int, int, int]) -> str:
    if head[0] > base[0]:
        return 'major'
    if head[0] == base[0] and head[1] > base[1]:
        return 'minor'
    if head[0] == base[0] and head[1] == base[1] and head[2] > base[2]:
        return 'patch'
    return 'none'


def required_bump_level(pr_title: str) -> str:
    first = pr_title.split('\n', 1)[0]
    match = CC_RE.match(first)
    if match is None:
        # cc_gate is the authoritative check for CC format; version_gate
        # assumes a compliant title. If we cannot parse it, be strict:
        # require at least patch.
        return 'patch'
    if match['breaking']:
        return 'major'
    if match['type'] == 'feat':
        return 'minor'
    return 'patch'


BANNER: Final[str] = 'VERSION GATE'
DEFAULT_HEADER: Final[str] = '# v{version}'
DEFAULT_NEWEST: Final[str] = 'first'
_VERSION_TOKEN: Final[str] = '([0-9A-Za-z.+\\-]+)'


def _header_re() -> re.Pattern[str]:
    """Compile the configured changelog header form into a matcher.

    The form is a template carrying `{version}` -- `# v{version}` here,
    `## [{version}] - ` in a Keep-a-Changelog repository. Literal runs are
    escaped so a form containing regex metacharacters (`[`, `]`, `.`) is
    matched literally, and runs of spaces become `\\s+` so header spacing is
    not load-bearing.
    """
    form = str(section_setting('changelog', 'header', DEFAULT_HEADER, BANNER))
    if '{version}' not in form:
        fail_setup(BANNER, f"changelog.header must contain '{{version}}', got {form!r}")
    before, _, after = form.partition('{version}')
    pattern = '^' + _escape_form(before) + _VERSION_TOKEN
    pattern += _escape_form(after) if after.strip() else '\\b'
    return re.compile(pattern)


def _escape_form(part: str) -> str:
    """Escape a literal run of the header form, turning every run of spaces
    into flexible whitespace -- including one adjacent to the version
    placeholder.

    Splitting on spaces and dropping empty chunks would silently delete the
    whitespace either side of `{version}`, so a form like `## {version}`
    compiled to a pattern demanding the version immediately after `##` and
    matched none of that repository's own headers.
    """
    out: list[str] = []
    for chunk in re.split(r'( +)', part):
        if not chunk:
            continue
        out.append(r'\s+' if chunk.isspace() else re.escape(chunk))
    return ''.join(out)


def _newest_first() -> bool:
    """Whether the newest entry sits at the top of the changelog.

    Both orderings are in use: this repository prepends, Keep-a-Changelog
    style repositories append. The gate checks the *new* section, so it has
    to know which end that is.
    """
    raw = section_setting('changelog', 'newest', DEFAULT_NEWEST, BANNER)
    if raw not in ('first', 'last'):
        fail_setup(BANNER, f"changelog.newest must be 'first' or 'last', got {raw!r}")
    return raw == 'first'


def _header_indices(lines: list[str], header_re: re.Pattern[str]) -> list[int]:
    return [i for i, line in enumerate(lines) if header_re.match(line)]


def _newest_index(lines: list[str], header_re: re.Pattern[str]) -> int | None:
    """Index of the header for the newest entry, per the configured order."""
    idx = _header_indices(lines, header_re)
    if not idx:
        return None
    return idx[0] if _newest_first() else idx[-1]

# Changelog writing conventions, the mechanizable subset: entries are
# imperative ("Add", not "Added"), and carry no leftover template
# placeholders. Only the new top section is checked, so old entries are
# never re-litigated.
_PAST_TENSE_BULLET_RE: Final[re.Pattern[str]] = re.compile(
    r'^\s*[-*]\s+(Added|Fixed|Removed|Changed|Updated|Renamed|Deleted|Moved|'
    r'Improved|Refactored|Bumped|Created|Introduced|Implemented|Replaced|'
    r'Dropped|Reverted|Disabled|Enabled|Documented|Skipped)\b'
)
_PLACEHOLDER_RE: Final[re.Pattern[str]] = re.compile(
    r'\b(?:TODO|FIXME|XXX|HACK|TBD)\s*:'                 # a marker note like "TODO: ..."
    r'|^\s*(?:[-*]\s+)?(?:TODO|TBD|WIP|N/?A|\.\.\.)\s*$',     # a bullet that is only a stub
    re.IGNORECASE,
)


def first_version_header(changelog_text: str) -> str | None:
    """Return the version string from the newest entry's header, or None if
    the changelog carries no header. Which end is newest is configured."""
    header_re = _header_re()
    lines = changelog_text.splitlines()
    i = _newest_index(lines, header_re)
    if i is None:
        return None
    match = header_re.match(lines[i])
    return match.group(1) if match else None

def top_section_is_empty(changelog_text: str) -> bool:
    """Require a content line beyond blank lines and Markdown headings."""
    return not any(
        line.strip() and not re.match(r'^\s*#+(?:\s|$)', line)
        for line in top_section_lines(changelog_text)
    )

def top_section_lines(changelog_text: str) -> list[str]:
    """The newest entry's content lines, up to the adjacent header or the end
    of file. Used to check the new entry's writing conventions without
    re-litigating older sections."""
    header_re = _header_re()
    lines = changelog_text.splitlines()
    start = _newest_index(lines, header_re)
    if start is None:
        return []
    out: list[str] = []
    for line in lines[start + 1:]:
        if header_re.match(line):
            break
        out.append(line)
    return out

def _changelog_failures(head_version: str, head_changelog: str) -> list[str]:
    """Apply the same release-note checks to an initial or subsequent version."""
    failures: list[str] = []
    top_header = first_version_header(head_changelog)
    if top_header is None:
        failures.append('CHANGELOG.md contains no `# v<X.Y.Z>` line. Add a version header.')
    elif top_header != head_version:
        failures.append(
            f'CHANGELOG.md top version header is `# v{top_header}` but '
            f'pyproject.toml reports {head_version!r}. The newest header must match.'
        )
    if top_section_is_empty(head_changelog):
        failures.append(
            f'CHANGELOG.md top version section (`# v{head_version}`) has no content before '
            'the next version header (or end of file). Describe the change.'
        )
    for raw in top_section_lines(head_changelog):
        past = _PAST_TENSE_BULLET_RE.match(raw)
        if past is not None:
            failures.append(f'CHANGELOG.md entry uses past tense {past.group(1)!r}; use an imperative: {raw.strip()!r}')
        placeholder = _PLACEHOLDER_RE.search(raw)
        if placeholder is not None:
            failures.append(f'CHANGELOG.md top section has an unfilled placeholder ({placeholder.group(0)!r}): {raw.strip()!r}')
    return failures


def gate(
    pr_title: str,
    base_pyproject: str,
    head_pyproject: str,
    base_changelog: str,
    head_changelog: str,
) -> list[str]:
    """Compare an established version and trail without any introduction bypass."""
    base_version = extract_version(base_pyproject, 'base')
    head_version = extract_version(head_pyproject, 'head')
    actual = bump_level(parse_semver(base_version), parse_semver(head_version))
    failures = _changelog_failures(head_version, head_changelog)
    if base_pyproject == head_pyproject:
        failures.append('pyproject.toml is byte-identical between base and head. Every PR must bump the version.')
    elif base_version == head_version:
        failures.append(f'pyproject.toml changed but [project].version is still {head_version!r}. Every PR must bump the version.')
    if actual == 'none':
        failures.append(f'version did not move forward. base={base_version!r}, head={head_version!r}.')
    if base_changelog == head_changelog:
        failures.append('CHANGELOG.md is byte-identical between base and head. Record the change.')
    required = required_bump_level(pr_title)
    if actual != 'none' and LEVEL_ORDER[actual] < LEVEL_ORDER[required]:
        failures.append(
            f'PR title {pr_title!r} requires at least a {required} version bump; '
            f'the actual bump is {actual} ({base_version} -> {head_version}).'
        )
    return failures


def _git(repository: Path, *arguments: str) -> str:
    """Read Git evidence; an unreadable ref must never look like a missing file."""
    try:
        result = subprocess.run(['git', *arguments], cwd=repository, text=True, capture_output=True, check=False)
    except OSError as exc:
        fail_setup(BANNER, f'cannot execute git: {exc}')
    if result.returncode:
        fail_setup(BANNER, f'git {arguments!r} failed: {result.stderr.strip()}')
    return result.stdout


def gate_from_git(pr_title: str, base_ref: str, repository: Path | None = None) -> list[str]:
    """Derive introduction eligibility from the committed base and head trees."""
    repo = repository or Path.cwd()
    base = _git(repo, 'rev-parse', '--verify', '--end-of-options', f'{base_ref}^{{commit}}').strip()
    head = _git(repo, 'rev-parse', '--verify', 'HEAD^{commit}').strip()
    _git(repo, 'merge-base', '--is-ancestor', base, head)
    paths: tuple[str, ...] = ('pyproject.toml', 'CHANGELOG.md')
    base_paths = set(_git(repo, 'ls-tree', '--name-only', base, '--', *paths).splitlines())
    head_paths = set(_git(repo, 'ls-tree', '--name-only', head, '--', *paths).splitlines())
    if head_paths != set(paths):
        return [f'head commit is missing required artifacts: {sorted(set(paths) - head_paths)}']
    head_project = _git(repo, 'show', f'{head}:pyproject.toml')
    head_changelog = _git(repo, 'show', f'{head}:CHANGELOG.md')
    if base_paths:
        if base_paths != set(paths):
            return ['partial version baseline: initial-version mode requires BOTH artifacts absent at base.']
        print(f'VERSION GATE -- COMPARISON (base {base}, head {head})')
        return gate(pr_title, _git(repo, 'show', f'{base}:pyproject.toml'), head_project,
                    _git(repo, 'show', f'{base}:CHANGELOG.md'), head_changelog)
    added = set(_git(repo, 'diff', '--name-only', '--no-renames', '--diff-filter=A',
                     base, head, '--', *paths).splitlines())
    if added != set(paths):
        return ['initial-version mode requires this PR to ADD both pyproject.toml and CHANGELOG.md.']
    print(f'VERSION GATE -- INITIAL VERSION (base {base}, head {head})')
    version = extract_version(head_project, 'head')
    parse_semver(version)
    return _changelog_failures(version, head_changelog)


def _read(path: str, label: str) -> str:
    try:
        return Path(path).read_text(encoding='utf-8')
    except OSError as exc:
        print(
            f'version_gate: cannot read --{label} {path}: {exc}',
            file=sys.stderr,
        )
        raise SystemExit(2) from exc


def main() -> int:
    exit_if_disabled('version', BANNER)
    parser = argparse.ArgumentParser(description='Version gate')
    parser.add_argument('--pr-title', required=True)
    parser.add_argument('--base-ref', help='Verified PR base commit; read both committed trees.')
    parser.add_argument('--base-pyproject')
    parser.add_argument('--head-pyproject')
    parser.add_argument('--base-changelog')
    parser.add_argument('--head-changelog')
    parser.add_argument(
        '--pr-author',
        default='',
        help='Login of the account that opened the PR. When it appears in '
             '`automation.bot_authors` and this gate is in '
             '`automation.exempt_gates`, the gate skips. Empty means enforce.',
    )
    args = parser.parse_args()
    exit_if_bot_exempt('version', args.pr_author, BANNER)

    artifacts = (args.base_pyproject, args.head_pyproject, args.base_changelog, args.head_changelog)
    if args.base_ref:
        if any(artifacts):
            parser.error('--base-ref cannot be combined with artifact paths')
        failures = gate_from_git(args.pr_title, args.base_ref)
    else:
        if not all(artifacts):
            parser.error('provide --base-ref or all four base/head artifact paths')
        failures = gate(args.pr_title, _read(args.base_pyproject, 'base-pyproject'),
                        _read(args.head_pyproject, 'head-pyproject'),
                        _read(args.base_changelog, 'base-changelog'),
                        _read(args.head_changelog, 'head-changelog'))

    if failures:
        print('VERSION GATE -- FAIL')
        print()
        for msg in failures:
            print(f'  - {msg}')
        print()
        print(f'{len(failures)} failure(s). Merge blocked.')
        return 1

    print('VERSION GATE -- PASS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
