#!/usr/bin/env python3
"""Synchronize the versioned label manifest without deleting unrelated labels."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import urllib.parse
from pathlib import Path
from typing import TypedDict, cast

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]


class Label(TypedDict):
    """The three fields owned by the repository's label manifest."""

    name: str
    color: str
    description: str


def _normalize_labels(payload: object, source: str) -> list[Label]:
    if not isinstance(payload, list) or not payload:
        raise SystemExit(f'labels: {source} must contain a non-empty label list')
    labels: list[Label] = []
    names: set[str] = set()
    for index, item in enumerate(cast(list[object], payload)):
        if not isinstance(item, dict):
            raise SystemExit(f'labels: {source}[{index}] must be an object')
        fields = cast(dict[object, object], item)
        name, color = fields.get('name'), fields.get('color')
        description = fields.get('description')
        if description is None:
            description = ''
        if (not isinstance(name, str) or not name.strip() or name != name.strip()
                or len(name) > 50 or not name.isprintable()):
            raise SystemExit(f'labels: {source}[{index}] has an invalid name')
        if name.casefold() in names:
            raise SystemExit(f'labels: {source} contains duplicate label {name!r}')
        if not isinstance(color, str) or not re.fullmatch(r'[0-9a-fA-F]{6}', color):
            raise SystemExit(f'labels: {source}[{index}] has an invalid color')
        if not isinstance(description, str) or len(description) > 100:
            raise SystemExit(f'labels: {source}[{index}] has an invalid description')
        names.add(name.casefold())
        labels.append({'name': name, 'color': color.lower(), 'description': description})
    return labels


def _manifest_path() -> Path:
    config = yaml.safe_load((REPO_ROOT / 'governance.yml').read_text(encoding='utf-8'))
    bootstrap = cast(dict[object, object], config).get('bootstrap') if isinstance(config, dict) else None
    value = cast(dict[object, object], bootstrap).get('labels_manifest') if isinstance(bootstrap, dict) else None
    if (not isinstance(value, str) or not value.strip()
            or Path(value).is_absolute() or '..' in Path(value).parts):
        raise SystemExit('labels: bootstrap.labels_manifest must name a repository-relative file')
    return REPO_ROOT / value


def load_labels(path: Path | None = None) -> list[Label]:
    """Validate every manifest entry before any GitHub operation is attempted."""
    source = path if path is not None else _manifest_path()
    return _normalize_labels(json.loads(source.read_text(encoding='utf-8')), str(source))


def _run_gh(args: list[str], *, body: dict[str, str] | None = None) -> str:
    command = ['gh', *args]
    if body is not None:
        command.extend(['--input', '-'])
    result = subprocess.run(
        command, input=json.dumps(body) if body is not None else None,
        capture_output=True, text=True, check=False,
    )
    if result.returncode:
        raise SystemExit(f'labels: gh failed: {result.stderr.strip() or result.stdout.strip()}')
    return result.stdout


def sync_labels(repo: str, manifest: Path | None = None, *, dry_run: bool = False) -> int:
    """Upsert validated labels and preserve every label outside the manifest."""
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise SystemExit('labels: --repo must be an explicit OWNER/REPOSITORY')
    labels = load_labels(manifest)
    pages = json.loads(_run_gh([
        'api', '--paginate', '--slurp', f'repos/{repo}/labels?per_page=100',
    ]))
    if not isinstance(pages, list):
        raise SystemExit('labels: expected paginated label lists from GitHub')
    raw_existing: list[object] = []
    for page in cast(list[object], pages):
        if not isinstance(page, list):
            raise SystemExit('labels: expected paginated label lists from GitHub')
        raw_existing.extend(cast(list[object], page))
    existing = _normalize_labels(raw_existing, 'GitHub response') if raw_existing else []
    by_name = {label['name'].casefold(): label for label in existing}
    changes = 0
    for label in labels:
        current = by_name.get(label['name'].casefold())
        if current == label:
            continue
        if current is None:
            method, endpoint = 'POST', f'repos/{repo}/labels'
            body = {
                'name': label['name'], 'color': label['color'],
                'description': label['description'],
            }
        else:
            encoded = urllib.parse.quote(current['name'], safe='')
            method, endpoint = 'PATCH', f'repos/{repo}/labels/{encoded}'
            body = {
                'new_name': label['name'], 'color': label['color'],
                'description': label['description'],
            }
        print(f'labels: {method} {repo} {label["name"]!r}' + (' (dry run)' if dry_run else ''))
        if not dry_run:
            _run_gh(['api', '-X', method, endpoint], body=body)
        changes += 1
    print(f'labels: {len(labels)} declared; {changes} changes; unrelated labels preserved')
    return changes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True, help='explicit OWNER/REPOSITORY target')
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    sync_labels(args.repo, args.manifest, dry_run=args.dry_run)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
