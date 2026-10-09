# Adslop

Adslop is an API-first instrument for generating incremental revenue from digital products through systematic advertising experiments.

Its first product release will provide one campaign creation and management experience across Google and Meta, keyword-based targeting, conversion tracking, unified performance measurement, deterministic PnL-based budget allocation, keyword pruning, and campaign reconciliation. Human and agent interfaces will use the same capabilities. Event sourcing, complete available provenance, experiment manifests, and reproducible releases form the foundation.

The initial operator is Mikko Kotila. The project begins as a private repository and is intended to develop into open-source software.

## Product specification

Read [the prose specification](SPECIFICATION.md) for the product requirements, execution and measurement behavior, and acceptance conditions. The [research and proposed stack](docs/Reference/Revenue-Engine-Research.md) records current Meta capabilities, deterministic control methods, and collection/data architecture tradeoffs.

The advertising engine has not yet been implemented. Meta's compatibility with the required keyword-targeting model remains an explicit capability dependency. Two-platform operation remains a first-release requirement.

## Current implementation

The foundation includes a local Cloudflare Worker economic API that records explicitly submitted subscription receipts, refunds, ad spend, and credits and calculates their difference without assigning subscription revenue to an ad platform. Duplicate event identities are handled transactionally and every admitted observation is retrievable. This API is not deployed and is not yet connected to actual advertising or billing accounts. It does not generate revenue on its own.

The planned Bunny importer polls Logging API v2 every minute and only admits HMAC-signed subscription receipts and refunds. A public pixel request cannot supply authoritative subscription revenue without a trusted commerce signature. The source Pull Zone ID, access key, event host, and signing key are provided as Cloudflare secrets/settings; none are in source control. The system retains per-request dispositions and rejects missing or malformed evidence. The trusted sender signs the URL query's `URLSearchParams.toString()` over `schema=1`, `product_id`, `source`, `event_id`, `kind`, `amount_minor`, `currency`, and `occurred_at` in that order using HMAC-SHA256, then appends `sig` as lowercase hexadecimal. Never include customer identifiers or other personal data in these URLs. The API exposes `POST /v1/bunny/poll`, `GET /v1/bunny/coverage?pull_zone_id=...`, and `GET /v1/bunny/records/{request_id}?pull_zone_id=...` behind the same bearer token. Live ingestion still requires a Bunny zone and a trusted subscription receipt source.

To verify the first executable money-in/money-out capability, run `corepack pnpm --dir apps/api install --frozen-lockfile && corepack pnpm --dir apps/api run check`. To run locally, supply a private `API_TOKEN` binding and use `corepack pnpm --dir apps/api run dev` (never commit credentials).

[SETUP.md](SETUP.md) records the GitHub activation procedure and the account prerequisites still outstanding. The checked-in protection policy requires independent review and passing checks. At initial adoption, GitHub refuses private-repository branch protection under the current account plan, both setup secrets are absent, and the write-access invitation for appointed independent reviewer `bit-mis` awaits acceptance. Committed policy is not evidence that server-side enforcement is active.

CodeQL follows the governance package's documented private-repository fallback. Its reactivation is tracked separately. Public package publication remains disabled, and no documentation site has been deployed.

## Meta Ads read-only reporting

The authenticated Worker API offers `GET /v1/meta/accounts` and
`GET /v1/meta/spend?account_id=<id>&since=YYYY-MM-DD&until=YYYY-MM-DD&level=account|campaign|adset|ad`.
The latter reports a separate account-level daily-spend baseline and a selected
daily reporting breakdown, with exact decimal-string minor units in the ad
account's native currency and account-local calendar. The response includes
the Meta Graph API version and observation timestamp so a later read can be
compared with its source revision; protected financial responses are not cached.
Meta's separate reporting levels must **never** be added to each other. A Meta Insights report is
platform-reported spend, **not** a settled advertising invoice; nothing is
imported into the money ledger by these read-only endpoints.

Supply `META_ACCESS_TOKEN` only as an encrypted Worker secret, backed by an
authorized Meta app with `ads_read` access to the selected ad account. The
existing `API_TOKEN` remains required for Adslop API callers. A browser login
to Ads Manager does not grant a Graph API access token. Never log credentials,
send them as URL query parameters or commit them to the repository. Responses
fail closed on inaccessible accounts, missing credentials, malformed amounts,
or incomplete upstream pages. The Meta API adapter is not live-validated until
an authorized Graph token is provided and results are checked against Meta's
own account reports. No ads are created, edited, or activated here.

## Local development

The canonical working directory is `~/dev/Adslop`.

Use Python 3.12 and the checked-in dependency locks:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python --require-hashes -r requirements/ci/dev-env.txt
uv pip install --python .venv/bin/python --require-hashes -r requirements/ci/runtime-env.txt
uv pip install --python .venv/bin/python --require-hashes -r requirements/ci/build-tools.txt
uv pip install --python .venv/bin/python --no-build-isolation --no-deps -e .
.venv/bin/python -m pytest tests/package governance/tests -q
.venv/bin/python -m ruff check adslop governance tests
```

The `adslop` import is only the package baseline. There is no campaign CLI or application server yet.

## Documentation

[The documentation index](docs/README.md) separates the current repository tools from the planned product. The full product contract remains in [SPECIFICATION.md](SPECIFICATION.md).

With Node.js 20 or newer:

```bash
npm --prefix docs-site ci
npm --prefix docs-site exec -- playwright install chromium
npm --prefix docs-site run security:audit
npm --prefix docs-site run check
npm --prefix docs-site start
```

Private GitHub links require authenticated repository access during validation. The documentation setup explains how to supply a narrowly scoped token through the environment.

## Contributing and governance

Read [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md), and [CONTRIBUTING.md](CONTRIBUTING.md) before changing the repository. Humans and agents follow the same issue, commit, verification, and review requirements.

Every delivery PR closes one open slice issue, stays within its declared file scope, uses a matching Conventional Commit title, and advances the version and changelog. The applicable required checks, written laws, and checked-in main ruleset must agree. Enforcement changes retain code-owner review and independent approval of the latest push.

## License

The adopted repository foundation uses the MIT license. See [LICENSE](LICENSE) for the permission terms and required copyright notice, and [THIRD_PARTY.md](THIRD_PARTY.md) for dependency information.
