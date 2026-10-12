"""Prevent branch deploys and accidental replacement of the live money ledger."""

import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/deploy_cloudflare.yml'
CONFIG = ROOT / 'apps/api/wrangler.deploy.jsonc'


def test_only_main_can_deploy_with_repository_secrets() -> None:
    workflow = yaml.load(WORKFLOW.read_text(), Loader=yaml.BaseLoader)
    assert workflow['on']['push']['branches'] == ['main']
    assert 'workflow_dispatch' in workflow['on']
    assert workflow['permissions'] == {'contents': 'read'}
    job = workflow['jobs']['deploy']
    assert job['if'] == "github.ref == 'refs/heads/main'"
    checkout = job['steps'][0]
    assert checkout['with']['persist-credentials'] == 'false'
    deploy = job['steps'][-1]
    assert deploy['env']['CLOUDFLARE_API_TOKEN'] == '${{ secrets.CLOUDFLARE_API_TOKEN }}'
    assert 'test -n "$CLOUDFLARE_API_TOKEN"' in deploy['run']
    assert 'wrangler deploy --config wrangler.deploy.jsonc --keep-vars --message "$GITHUB_SHA"' in deploy['run']


def test_deployments_serialize_and_reject_superseded_main_heads() -> None:
    workflow = yaml.load(WORKFLOW.read_text(), Loader=yaml.BaseLoader)
    assert workflow['concurrency']['cancel-in-progress'] == 'false'
    steps = workflow['jobs']['deploy']['steps']
    revision = next(step for step in steps if step.get('id') == 'revision')
    assert 'git/ref/heads/main' in revision['run']
    assert '[ "$latest" = "$GITHUB_SHA" ]' in revision['run']
    assert 'current=false' in revision['run']
    assert steps[-1]['if'] == "steps.revision.outputs.current == 'true'"
    assert any(step.get('run') == 'corepack pnpm install --frozen-lockfile' for step in steps)


def test_deployment_preserves_the_existing_money_ledger_and_collection() -> None:
    config = json.loads(CONFIG.read_text())
    assert config['name'] == 'adslop-api-preview'
    assert config['account_id'] == '758576157d0685fa4eb2aeaf16781577'
    assert config['main'] == 'src/index.ts'
    assert config['durable_objects']['bindings'] == [
        {'name': 'MONEY', 'class_name': 'MoneyLedger'}
    ]
    assert config['migrations'] == [
        {'tag': 'v1', 'new_sqlite_classes': ['MoneyLedger']}
    ]
    assert config['triggers']['crons'] == ['* * * * *']
    assert config['vars'] == {
        'BUNNY_PULL_ZONE_ID': '6769737',
        'BUNNY_COLLECT_HOST': 'adslop-event-collector-j6mco.bunny.run',
    }
    assert not any('TOKEN' in key or 'KEY' in key for key in config['vars'])
