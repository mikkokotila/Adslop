# Adslop

Adslop is an API-first instrument for generating incremental revenue from digital products through systematic advertising experiments.

Its first product release will provide one campaign creation and management experience across Google and Meta, keyword-based targeting, conversion tracking, unified performance measurement, deterministic PnL-based budget allocation, keyword pruning, and campaign reconciliation. Human and agent interfaces will use the same capabilities. Event sourcing, complete available provenance, experiment manifests, and reproducible releases form the foundation.

The initial operator is Mikko Kotila. The project begins as a private repository and is intended to develop into open-source software.

## Product specification

Read [the prose specification](SPECIFICATION.md) for the product requirements, execution and measurement behavior, and acceptance conditions. The [research and proposed stack](docs/Reference/Revenue-Engine-Research.md) records current Meta capabilities, deterministic control methods, and collection/data architecture tradeoffs.

Google Ads source reporting, revision-aware money-out imports, and pause-only Search campaign preparation are implemented in the local Worker. Live Google Ads account validation and authorized campaign write/readback remain outstanding; paid activation is not implemented. Meta's compatibility with the required keyword-targeting model remains an explicit capability dependency. Two-platform operation remains a first-release requirement.

## Current implementation

The foundation includes a local Cloudflare Worker economic API that records explicitly submitted subscription receipts, refunds, ad spend, and credits and calculates their difference without assigning subscription revenue to an ad platform. Duplicate event identities are handled transactionally and every admitted observation is retrievable. The Bunny collection preview is deployed; live advertising and billing account integration remains unverified. It does not generate revenue on its own.

The planned Bunny importer polls Logging API v2 every minute and only admits HMAC-signed subscription receipts and refunds. A public pixel request cannot supply authoritative subscription revenue without a trusted commerce signature. The source Pull Zone ID, access key, event host, and signing key are provided as Cloudflare secrets/settings; none are in source control. The system retains per-request dispositions and rejects missing or malformed evidence. The trusted sender signs the URL query's `URLSearchParams.toString()` over `schema=1`, `product_id`, `source`, `event_id`, `kind`, `amount_minor`, `currency`, and `occurred_at` in that order using HMAC-SHA256, then appends `sig` as lowercase hexadecimal. Never include customer identifiers or other personal data in these URLs. The API exposes `POST /v1/bunny/poll`, `GET /v1/bunny/coverage?pull_zone_id=...`, and `GET /v1/bunny/records/{request_id}?pull_zone_id=...` behind the same bearer token. Live ingestion still requires a Bunny zone and a trusted subscription receipt source.

The Google Ads read API uses a separately authorized, offline OAuth 2.0 refresh token (scope `https://www.googleapis.com/auth/adwords`). Provision `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, and `GOOGLE_ADS_REFRESH_TOKEN` as private Worker secrets; optionally set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to a ten-digit manager ID without hyphens for accounts outside discovery. The Google Ads developer token must have access to the requested live account. No token, credential, or account identity is committed. The existing `API_TOKEN` protects all endpoints.

- `GET /v1/google-ads/accounts`: directly accessible customers and enabled clients of accessible managers, with currency and time zone. Optional display names are `null` when Google supplies no name; direct account reads omit the manager login header, and managed reads use the client's discovered manager context.
- `GET /v1/google-ads/accounts/{id}/campaigns` and `/keywords`: native inventory and stable IDs.
- `GET /v1/google-ads/accounts/{id}/spend?from=YYYY-MM-DD&to=YYYY-MM-DD&view=campaign` (or `account`, `keyword`, `creative`): Google-account-local date range, exact string-valued `account_spend_micros`, row evidence and separately labeled breakdown. Google defines one currency unit as one million micro-units. Account spend is authoritative *for the reported metric and time frame*, not an invoice settlement; keyword and creative views can omit or suppress detail, and **must never be added** to account or campaign totals. Pagination is fetched to completion or reported as a failure, not silently truncated. To record native campaign costs, submit `POST /v1/google-ads/accounts/{id}/reconcile` with `{"product_id":"your-product","from":"YYYY-MM-DD","to":"YYYY-MM-DD","campaign_ids":["native-campaign-id"]}`. The importer compares the complete campaign/day micro-unit source to Google's account total, rejects mismatches and ambiguously overlapping manual Google spends, and appends only new/corrected observations. Read all historical report revisions at `GET /v1/google-ads/accounts/{id}/revisions`. Product-campaign assignment is explicit; costs from other campaigns are not attributed to that product. Ledger output adds exact `advertising_spend_micros` and `difference_micros`; `*_minor` becomes `null` when an exact integer minor-unit amount is not representable (never rounded). This is Google reporting cost, not invoice settlement. API and OAuth failures include an actionable error code; Google `request-id` is returned when available.

To prepare a campaign without activating paid delivery, `POST /v1/google-ads/accounts/{id}/paused-search-campaigns` with `{"contains_eu_political_advertising":"DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING","name":"New Search","daily_budget_micros":"10000000","cpc_bid_micros":"250000","keywords":[{"text":"example keyword","match_type":"EXACT"}],"headlines":["First headline","Second headline","Third headline"],"descriptions":["First description","Second description"],"final_url":"https://example.org/landing"}`. Declare the advertiser's actual EU political-ad status explicitly; this endpoint accepts only `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` and rejects missing or political declarations. The create uses one GoogleAdsService atomic mutate with PAUSED campaign, ad group, keywords and responsive search ad, then independently queries Google's stored campaign, budget, keyword and ad details before returning `verified_paused`. A lost transport response, unreadable successful response, server failure, or failed readback after an acknowledged mutation returns `status: "write_unverified"` with the source error/request ID and only the native identities actually known. Do not repeat the create: inspect native inventory when the response has no campaign ID, then use the individual `GET` endpoint to read the existing campaign. Explicit upstream client rejections remain errors without that uncertain-write marker. Only a request with valid credentials and Google Ads mutate access can create an actual paused campaign. `PATCH /v1/google-ads/accounts/{id}/paused-search-campaigns/{campaignId}` accepts only `name` and/or `daily_budget_micros`, rejects active campaigns and shared budgets, and re-reads the native state. `GET` on that individual campaign returns current native paused state. The API exposes no `ENABLED` or paid activation operation and will not automatically retry ambiguous mutates. Live proof remains blocked until production account write access is available.

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

### Meta spend reconciliation

After authorizing a Meta app for the selected ad account with an `ads_read`
Graph API token, import native reported cost through
`POST /v1/meta/accounts/{account_id}/reconcile` with
`{"product_id":"your-product","since":"YYYY-MM-DD","until":"YYYY-MM-DD","campaign_ids":["native-campaign-id"]}`.
The importer fetches independent account and campaign/day reports, checks that
they reconcile by **each local day**, not merely by period total, and attributes
**only explicitly selected campaigns**
to the product. Missing or contradictory source records, manually entered Meta
spend for the same product/currency, and reassigned native campaigns fail closed.
Identical retries do not increase money-out; corrected source cost becomes a new
revision. Inspect its history at `GET /v1/meta/accounts/{account_id}/revisions`.
`GET /v1/economics` includes the latest imported Meta daily costs, with exact
minor units and no campaign/adset/ad reporting-level double counting. The
existing Google micro-unit precision and receipt/refund provenance are preserved.

These figures are *Meta-reported advertising spend*, not invoice settlement or
demonstrated incremental subscription revenue. The integration is not live
validated until a real authorized Meta Graph account report can be compared
with the same period in Ads Manager. No Meta ad mutation is implemented here.

## Cloudflare deployment

Merges to `main` run `.github/workflows/deploy_cloudflare.yml` with the locked
Worker toolchain and `apps/api/wrangler.deploy.jsonc`. The deployment updates
`adslop-api-preview` while preserving its existing MoneyLedger SQLite namespace,
Bunny Pull Zone, one-minute schedule, and encrypted Worker secrets. Each version
records the merged commit SHA. Deployments serialize and skip superseded heads.

GitHub Actions requires repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. Scope the token to deployment of this Worker in the
existing Cloudflare account. Billing and advertising tokens stay in encrypted
Worker secrets; they are never copied into the repository or deployment logs.
The workflow can also be dispatched from `main` after a deployment failure.

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
