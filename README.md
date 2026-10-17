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

The Google Ads read API uses a separately authorized, offline OAuth 2.0 refresh token (scope `https://www.googleapis.com/auth/adwords`). Provision `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, and `GOOGLE_ADS_REFRESH_TOKEN` as private Worker secrets; optionally set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to a ten-digit manager ID without hyphens for accounts outside discovery. Google sunset developer tokens on 9 September 2026: no developer token or `developer-token` header is required. Production access is determined by the Google Cloud project behind these OAuth credentials (Explorer, Basic or Standard access), not a developer token. See [Google Ads API developer-token sunset](https://developers.google.com/google-ads/api/docs/api-policy/developer-token). No token, credential, or account identity is committed. The existing `API_TOKEN` protects all endpoints.

- `GET /v1/google-ads/accounts`: directly accessible customers and enabled clients of accessible managers, with currency and time zone. Optional display names are `null` when Google supplies no name; direct account reads omit the manager login header, and managed reads use the client's discovered manager context.
- `GET /v1/google-ads/accounts/{id}/campaigns` and `/keywords`: native inventory and stable IDs.
- `GET /v1/google-ads/accounts/{id}/spend?from=YYYY-MM-DD&to=YYYY-MM-DD&view=campaign` (or `account`, `keyword`, `creative`): Google-account-local date range, exact string-valued `account_spend_micros`, row evidence and separately labeled breakdown. Google defines one currency unit as one million micro-units. Account spend is authoritative *for the reported metric and time frame*, not an invoice settlement; keyword and creative views can omit or suppress detail, and **must never be added** to account or campaign totals. Pagination is fetched to completion or reported as a failure, not silently truncated. To record native campaign costs, submit `POST /v1/google-ads/accounts/{id}/reconcile` with `{"product_id":"your-product","from":"YYYY-MM-DD","to":"YYYY-MM-DD","campaign_ids":["native-campaign-id"]}`. The importer compares the complete campaign/day micro-unit source to Google's account total, rejects mismatches and ambiguously overlapping manual Google spends, and appends only new/corrected observations. Read all historical report revisions at `GET /v1/google-ads/accounts/{id}/revisions`. Product-campaign assignment is explicit; costs from other campaigns are not attributed to that product. Ledger output adds exact `advertising_spend_micros` and `difference_micros`; `*_minor` becomes `null` when an exact integer minor-unit amount is not representable (never rounded). This is Google reporting cost, not invoice settlement. API and OAuth failures include an actionable error code; Google `request-id` is returned when available.

To prepare a campaign without activating paid delivery, `POST /v1/google-ads/accounts/{id}/paused-search-campaigns` with `{"contains_eu_political_advertising":"DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING","name":"New Search","daily_budget_micros":"10000000","cpc_bid_micros":"250000","keywords":[{"text":"example keyword","match_type":"EXACT"}],"headlines":["First headline","Second headline","Third headline"],"descriptions":["First description","Second description"],"final_url":"https://example.org/landing"}`. Declare the advertiser's actual EU political-ad status explicitly; this endpoint accepts only `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING` and rejects missing or political declarations. The create uses one GoogleAdsService atomic mutate with PAUSED campaign, ad group, keywords and responsive search ad, then independently queries Google's stored campaign, budget, keyword and ad details before returning `verified_paused`. A lost transport response, unreadable successful response, server failure, or failed readback after an acknowledged mutation returns `status: "write_unverified"` with the source error/request ID and only the native identities actually known. Do not repeat the create: inspect native inventory when the response has no campaign ID, then use the individual `GET` endpoint to read the existing campaign. Explicit upstream client rejections remain errors without that uncertain-write marker. Only a request with valid credentials and Google Ads mutate access can create an actual paused campaign. `PATCH /v1/google-ads/accounts/{id}/paused-search-campaigns/{campaignId}` accepts only `name` and/or `daily_budget_micros`, rejects active campaigns and shared budgets, and re-reads the native state. `GET` on that individual campaign returns current native paused state. The API exposes no `ENABLED` or paid activation operation and will not automatically retry ambiguous mutates. Live proof remains blocked until production account write access is available.

To verify the first executable money-in/money-out capability, run `corepack pnpm --dir apps/api install --frozen-lockfile && corepack pnpm --dir apps/api run check`. To run locally, supply a private `API_TOKEN` binding and use `corepack pnpm --dir apps/api run dev` (never commit credentials).

[SETUP.md](SETUP.md) records the GitHub activation procedure and the account prerequisites still outstanding. The checked-in protection policy requires independent review and passing checks. At initial adoption, GitHub refuses private-repository branch protection under the current account plan, both setup secrets are absent, and the write-access invitation for appointed independent reviewer `bit-mis` awaits acceptance. Committed policy is not evidence that server-side enforcement is active.

CodeQL follows the governance package's documented private-repository fallback. Its reactivation is tracked separately. Public package publication remains disabled, and no documentation site has been deployed.

## Explicit Google campaign geography and language

Authenticated `GET /v1/google-ads/accounts/{account_id}/paused-search-campaigns/{campaign_id}/targeting` reads a PAUSED Search campaign's current native criteria and constants. Empty country or language criteria are reported as empty, with `geography_and_language_bounded: false`; no country or language is assumed. Removed criteria are excluded, and paused positive criteria do not establish active bounds.

`PUT` on the same path accepts only explicit `countries` and `languages`, for example `{"countries":["US"],"languages":["en"]}`. These values are examples, not defaults. Each list must contain 1–20 unique native codes. Country codes are uppercase ISO-style codes; language codes must resolve exactly in Google's targetable language catalogue. Unknown, disabled or ambiguous constants fail before mutation. The path verifies native account ownership and requires a PAUSED Search campaign.

One atomic GoogleAds mutation replaces positive location/language criteria, sets presence-only positive geography and explicitly retains campaign PAUSED status. It preserves matching active constraints, negative geography, device criteria and other unrelated criteria. Independent native readback must match the requested constants, presence setting, paused state and preserved criteria. An identical verified configuration sends no mutation. A definitive native 4xx rejection is `write_rejected`; lost responses or unverifiable readback after acknowledgment are `write_unverified`. Both retain the known campaign and safe native HTTP status. Writes are never automatically retried. Native configuration is not paid-launch approval or proof of settled spend: responses retain `launch_ready: false` and `paid_delivery_authorized: false`.

## Campaign pause and durable evidence

Authenticated `POST /v1/{google-ads|meta}/accounts/{account_id}/campaigns/{campaign_id}/pause` accepts only `{}`. It checks native ownership, campaign identity and configured status, requests only `PAUSED` when necessary, and independently reads the campaign again before returning `verified_paused`. Google's campaign resource namespace and Meta's campaign-only objective/buying-type fields distinguish campaigns from child ads/ad sets; a paused child cannot satisfy the request. An already paused campaign receives no native mutation. The operation neither activates delivery nor changes children, budgets, targeting, billing or money observations. A verified configured pause does not establish immediate spend settlement.

Each POST creates a new explicit operator attempt. The existing Durable Object records the request before native calls, then checkpoints the write intent, acknowledgment and independent observations. Failed readback or ambiguous execution returns `write_unverified`; a definitive provider rejection is `write_rejected`. No native write is automatically retried. Inspect the provider before making a new explicit attempt after uncertainty; replaying history never executes an action.

`GET` on the same path returns the last 100 durable attempts, newest first, with `limit` and `truncated`. It performs no native calls and does not claim current native status. An interrupted attempt retains its last checkpoint (`incomplete` or `write_unverified`), including across actor eviction. Both methods require the operator bearer, reject query parameters and return `Cache-Control: no-store`. Native Meta pause acceptance requires actual write access; tests of the protocol are not proof of that grant. Native active-to-paused proof requires an authorized active campaign; never activate an object to manufacture a stop test.

## Meta paused image ads

`GET /v1/meta/accounts/{account_id}/creative-assets` reads the account, promotable Pages the authenticated user can advertise, native image hashes, campaigns, ads, creatives and granted token permissions. Page discovery uses paginated `me/accounts` with `is_promotable=true` and requires native `ADVERTISE` or `MANAGE` tasks; those tasks accompany each returned Page. An account's promoted-Page history is not a complete authorization list for a new Page's first ad. Each collection reports `available` or `unavailable`; inaccessible or malformed Page evidence is not an empty list. Page access tokens are never returned. This inventory is read-only.

`POST /v1/meta/accounts/{account_id}/images` accepts `{ "image_base64": "<PNG-or-JPEG-bytes-as-base64>" }`, up to 4 MiB decoded. It uploads the image to Meta, retains a SHA-256 of the submitted bytes and independently queries the account image by returned hash. Use an actual authorized product image, not a fabricated customer or chart.

`POST /v1/meta/accounts/{account_id}/paused-ads` accepts this shape (IDs and hash must come from native account evidence):

```json
{
  "name": "Eightchord | Chinese zodiac | Paused",
  "campaign_id": "<native-campaign-id>",
  "adset_id": "<native-adset-id>",
  "page_id": "<eligible-Page-id>",
  "image_hash": "<native-image-hash>",
  "final_url": "https://eightchord.com/",
  "primary_text": "Explore your four Chinese zodiac signs with Eightchord.",
  "headline": "Your Chinese zodiac chart",
  "description": "Explore Eightchord.",
  "parent_expectation": {
    "daily_budget_minor": "500",
    "countries": ["US"],
    "interest_ids": ["<native-interest-id>"]
  }
}
```

Both POST routes require `Idempotency-Key`, a unique 1–128-character operation name. Repeating the **same path and exact request body** with the same account/key returns the stored result without resending external writes. Reusing the key with different input returns `409 meta_idempotency_conflict`. An interrupted operation returns `write_unverified`; inspect native inventory rather than retrying a create under a new key. The existing Durable Object stores request hashes, each acknowledged native identity before the next write, and safe results—not credentials or uploaded image bytes. Cached operation results retain their original observation timestamp; use the independent GET for current state.

If an attempt acknowledged a creative but no ad was written, an explicit recovery can add `"creative_id":"<acknowledged-creative-id>"` to the full paused-ad request with a new operation key. First reconcile the previous attempt and native inventory; if an ad write was ambiguous, locate and inspect that ad before considering another create. The recovery independently verifies the existing creative's identity, account, Page, image, destination, copy and CTA, rejects alternate asset feeds, and creates no additional creative. Invalid or mismatched creative evidence blocks the ad write. Meta may assign a different creative-library name; that observed metadata name remains in readback, while the requested ad name must match exactly.

The ad path checks account ownership, PAUSED campaign/ad-set parents, non-special-category traffic configuration, exact requested country/interest sets and budget, eligible Page, and account-owned image. Before any creative write or reuse, it verifies the user's Page advertising task and independently reads the selected Page's `promotion_eligible` boolean; false or unknown eligibility blocks creation. Native Meta writes still enforce account-specific authorization. Without `creative_id`, it creates a link creative and reads back its Page, image, text and destination. Both paths recheck the parents and create the ad **PAUSED**. A final independent read verifies ad/creative/parent identities, ad name and copy. `GET /v1/meta/accounts/{account_id}/paused-ads/{ad_id}` returns current native paused state; it does not claim comparison with an unprovided historical request. Ambiguous writes retain every acknowledged image/creative/ad ID and never retry automatically. Safe upstream codes and trace IDs distinguish permission failures from missing data without returning secret-bearing messages.

A verified paused configuration is **not approval to run, proof of platform ad review, or proof that Meta delivery expansion is disabled**. The API reports `launch_ready: false`; review effective placements, expansion and consent/payment readiness separately before any future activation. No route activates an ad. Existing audience-preparation routes remain distinct; image/ad retry protection does not retroactively make campaign/ad-set creation idempotent. Live Eightchord Page grants and image/ad results remain unverified until authenticated account execution succeeds.

## Meta paused audience preparation

Native readback accepts either top-level `interests` or one interest-only
`flexible_spec` OR group, as Meta may normalize the same audience during native
review. Mixed representations, multiple groups, additional group predicates and
malformed or duplicate interest IDs fail verification. The original native
targeting remains visible; this does not disable or conceal audience expansion.

First discover genuine Meta interest IDs with authenticated `GET /v1/meta/targeting-interests?q=astrology`. The response records `source=meta_targeting_search`, `targeting_mode=AUDIENCE_INTERESTS`, and each source ID/name. This searches the interest catalog rather than specifying positive query keywords.

The authenticated Worker offers `POST /v1/meta/accounts/{account_id}/paused-audience-campaigns` with `{"name":"Eightchord | Meta | Paused","targeting_mode":"AUDIENCE_INTERESTS","daily_budget_minor":"500","countries":["US"],"interest_ids":["verified-native-interest-id"]}`. The API requires real, source-verified Meta interest IDs, an explicitly selected country and USD-account-local currency minor-unit daily budget. It creates an `OUTCOME_TRAFFIC` campaign and `LINK_CLICKS` ad set with `PAUSED` status, then independently reads back native status, audience and budget. It never activates paid delivery. A partial, uncertain or unverified write is reported as `write_unverified`; do not retry creation automatically. `GET /v1/meta/accounts/{account_id}/paused-audience-campaigns/{campaign_id}` verifies a paused native campaign. **No ad or creative is created**: that requires an authorized Facebook Page, real approved creative and an additional reviewed capability. This is interest-based audience targeting, **not** keyword-matched inventory. Your operator authorization permits this explicitly as a Meta-specific fallback; it does not establish positive keyword matching. `ads_management` and the ad-account write grant are required; `ads_read` alone is insufficient. Campaign preparation is not equivalent to completed two-platform campaign publication.

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

Meta Graph requests use Workers-supported manual redirects and reject redirect
responses, preventing authorization from being forwarded to another destination.
Rotate user access tokens before their reported expiry to retain reporting access.

## Dated economic evidence

Authenticated `GET /v1/economics/period?product_id=eightchord&currency=USD&from=2026-10-05&to=2026-10-11&time_zone=Europe%2FHelsinki` reads existing cash observations and the latest imported Google/Meta daily cost revisions. Dates are inclusive, with an explicit IANA reporting timezone; ranges are limited to 366 calendar days and 10,000 rows per source. The read takes one Durable Object snapshot, performs no external requests, creates no observations and cannot activate ads. The original all-time `/v1/economics` contract is unchanged.

Cash and manually admitted spend/credits are filtered by occurrence in the requested timezone (including daylight-saving changes). Native advertising daily rows retain their source timezone. Rows from a different timezone are displayed separately and make the requested-period difference unavailable: Adslop never prorates a daily report or pretends that identical calendar dates are identical UTC intervals. Each native cost identity contributes only its latest stored revision, not every historical correction or every reporting dimension.

All monetary subtotals are exact decimal integer strings, in currency minor units for receipts/refunds and micro-units for combined advertising cost. Each currency has its own report; no FX rate or currency conversion is invented. `observed_difference_micros` is present only when both sides have observations and the native timezones align. It is a difference of observed evidence, **not proof of full-period profit**. No receipt data is `no_observations`, not verified zero. Coverage always remains explicitly incomplete until actual source-completeness evidence exists. A null difference is not a loss or a zero. Legacy observation arrival times are unavailable; source cost rows retain their observation timestamp and revision.

The reader reports the sources admitted by the current main branch. Live Stripe effects admitted by the signed receiver are included with native invoice/charge identities, tax metadata, occurrence basis and observation timestamps. Sandbox effects are excluded. An unresolved Stripe source break affecting previously admitted product/currency cash withholds the difference, even in a historical period; this is a current-source read, not an as-of audit. A live Stripe account alone does not populate the report. No dashboard, forecast, attribution rule, ad-account mutation or subscription-accounting change is introduced.

## Cloudflare deployment

Merges to `main` run `.github/workflows/deploy_cloudflare.yml` with the locked
Worker toolchain and `apps/api/wrangler.deploy.jsonc`. The deployment updates
`adslop-api-preview` while preserving its existing MoneyLedger SQLite namespace,
Bunny Pull Zone, one-minute schedule, and encrypted Worker secrets. Each version
records the merged commit SHA. Deployments serialize and skip superseded heads.

GitHub Actions requires repository secret `CLOUDFLARE_API_TOKEN`; the existing
account ID is pinned in the deployment configuration. Scope the token to Worker
deployment in that account. Deployment retains dashboard-managed variables. Billing and advertising tokens stay in encrypted
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

## Stripe subscription cash

ISK and UGX require explicit normalization of Stripe's special wire-unit scale and are currently quarantined, not interpreted with an incorrect ledger scale. See [Stripe currency special cases](https://docs.stripe.com/currencies).

The Stripe adapter is independent of Eightchord checkout and subscription access. It exposes signature-authenticated `POST /v1/stripe/{live|sandbox}/webhook` and bearer-protected `GET /v1/stripe/{mode}/status`, `POST /v1/stripe/{mode}/import`, `GET /v1/stripe/{mode}/events/{event_or_invoice_id}`, and `GET /v1/stripe/{mode}/effects?product_id=eightchord`. Invoice re-import dispositions are available under their `in_` ID, not just `evt_` notifications. Effects are keyset-paginated with `limit` (1–1000, default 100), optional `after`, `has_more` and `next_cursor`; follow the returned cursor without assuming a first page is the complete history. Event/invoice disposition reads explicitly return the latest 100 attempts.

Set separate encrypted `STRIPE_LIVE_CONNECTION` and `STRIPE_SANDBOX_CONNECTION` JSON secrets with `account_id`, `api_key`, `webhook_secret`, and `prices`. Each native Price ID maps to an object with `product_id` and `stripe_product_id`. Native Product IDs may be merchant-defined rather than start with `prod_`: accept bounded IDs and still require exact agreement between the configured mapping, invoice line and independently read Price. See [Stripe custom product identifiers](https://docs.stripe.com/api/products/create). Real account and price IDs must come from the checkout engineer. Adslop uses only read permissions for account identity, Events, Invoices/lines/payments, Prices, PaymentIntents, Charges, Refunds and Disputes. No API writes, customer charges, entitlement changes or payout operations are implemented.

For direct dashboard setup, the credentials may instead be separate encrypted Worker secrets:
`STRIPE_SANDBOX_API_KEY` and `STRIPE_SANDBOX_WEBHOOK_SECRET` (or the corresponding
`STRIPE_LIVE_` names). In that form, the mode's `STRIPE_*_CONNECTION` JSON contains
only `account_id` and `prices`. Each credential must exist in exactly one location;
duplicate locations, even with equal values, are rejected instead of selecting an
implicit precedence. Moving one credential at a time is supported. Empty, invalid,
wrong-mode or incomplete configuration fails before native reads. Both credentials
and the account/price mapping remain required; storing a key alone does not connect
Stripe. Keep secrets in [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/),
not source control, browser code or chat. No secret value is returned by status or evidence routes.

Configuration errors retain HTTP 503 and `error: "stripe_invalid_configuration"`,
with `configuration_issue: {"field":"api_key","reason":"invalid"}` identifying
the failed check. Fields are `connection`, `account_id`, `api_key`, `webhook_secret`
or `prices`; reasons are `invalid`, `missing` or `ambiguous`. No configured value
or parser message is returned. An absent connection remains `stripe_not_configured`.
Correct the identified configuration, then retry the same event or invoice;
the diagnostic does not establish native access or financial acceptance.

The accounting basis is gross captured subscription customer cash, including tax and before fees, minus actual successful cash refunds. Invoice tax is retained separately; refund tax allocation is unknown, not invented. This is not earned revenue, tax-exclusive sales or settled bank payout. One fully paid recurring product/invoice and one captured payment are supported; split/credited/off-Stripe payments, unmatched price mappings and disputes are quarantined. Unpaid invoices with positive paid amounts are quarantined rather than labelled zero cash. Empty paid-allocation listings and inconsistent refund totals are retried rather than silently accepted. Mode/account identities are checked natively; sandbox effects never enter live economics. Charge/refund IDs, not notification IDs, prevent duplicate cash. A repeat operator import of a known event or invoice re-reads the native source but cannot create financial operations. Invoice import remains usable after event-retrieval retention expires.

Receipt occurrence uses InvoicePayment paid_at; successful refund occurrence uses the Refund created timestamp, not an asserted bank-settlement time. Service periods are retained separately. Stored evidence contains safe IDs, money, timestamps and dispositions rather than customer PII, raw event bodies or credentials. Coverage remains not_verified. Do not also forward the same Stripe payments via Bunny/manual observations under another source name: different external source identifiers cannot establish that two reports describe the same cash. Adslop is the sole Stripe cash admission path for its configured product; Eightchord owns fulfillment, not duplicate money forwarding. Known mapped-product source failures (including partial cash before first admission) or disputes after an invoice was admitted preserve historical effects and append a reconciliation break. The all-time cash headline and difference become null with `cash_status=reconciliation_required`; dated reports also withhold their difference. No dispute amount is guessed as a refund. A full, consistent native invoice refresh can clear a transient break; unsupported disputes remain unresolved until explicitly supported and reconciled. Imports serialize and return retryable 503 while another acquisition is running.

Register a separate snapshot webhook destination, distinct from Eightchord's fulfillment destination. Configure invoice.paid, invoice.payment_succeeded, invoice.payment_failed, refund.created, refund.updated, refund.failed, charge.refunded and charge.dispute events. Use its own signing secret. The implementation verifies raw-body HMAC signatures with a five-minute timestamp tolerance, then independently retrieves native objects using the pinned 2026-07-29.dahlia API. It does not trust webhook amount fields.

**Verification boundary:** Workers-runtime protocol tests cover real signature computation, native-source checks, receipts, partial refunds, renewals, failed payments, replay, interruption, reconciliation breaks, evidence pagination, and dated sandbox isolation. These test fixtures are not actual Stripe account transactions. Native sandbox acceptance still requires Adslop-specific credentials, this destination's signing secret and confirmed Price/Product IDs; do not enable live admission or claim commercial proof from unit tests. The public website can remain unfinished while these accounting tests run.

Sources: [Stripe webhooks](https://docs.stripe.com/webhooks), [Invoice Payment](https://docs.stripe.com/api/invoice-payment/object), [Refund](https://docs.stripe.com/api/refunds/object), [API changelog](https://docs.stripe.com/changelog).

### Eightchord engineer handoff

Use stable Adslop product ID `eightchord`. Share the sandbox and live Stripe account, native Product and recurring Price IDs through the private deployment configuration, not browser-submitted attribution. Register separate Adslop snapshot destinations `/v1/stripe/sandbox/webhook` and `/v1/stripe/live/webhook` at the approved Worker origin, each with its own signing secret; do not replace Eightchord's fulfillment destination. Keep all Stripe credentials in encrypted Worker secrets. Adslop needs read-only native financial access and never creates a payment, refund or customer. Checkout, entitlement transitions and plan pricing remain entirely with Eightchord.
