# v0.11.0

- Add native Stripe subscription cash and refund verification with separate sandbox evidence.
- Preserve exact cash identities and explicit unsupported-source dispositions without changing checkout or paid delivery.

# v0.10.0

- Discover eligible Meta Pages and account images without exposing Page tokens.
- Create paused image ads only after verifying native parents, Page, image, copy and destination.
- Preserve native write identities and persist operation results to prevent duplicate image, creative or ad writes on retries.

# v0.9.0

- Prepare paused Meta traffic campaigns and audience-targeted ad sets, with independent native readback and explicit non-keyword semantics.
- Expose partial native writes as unverified without automatic mutation retries or paid activation.

# v0.8.3

- Use supported redirect handling for Meta reports in the Workers runtime without forwarding credentials.

# v0.8.2

- Deploy the existing Cloudflare Worker after merges to main while preserving the money ledger, Bunny settings, and secrets.

# v0.8.1

- Remove the retired Google Ads developer-token prerequisite and header from account reads, cost reconciliation, and paused Search campaign writes.
- Keep OAuth authorization and Google Cloud project access checks while exercising tokenless requests in the Workers runtime.

# v0.8.0

- Reconcile complete native Meta daily campaign costs against reported account spend.
- Preserve corrected Meta spend as append-only revisions without double-counting.
- Reject conflicting product mappings, incomplete source reports and manual Meta overlaps.

# v0.7.1

- Grant the slice closeout job repository read access so private-repository checkout can verify merged issue evidence.
- Guard effective checkout permissions against job-level permission overrides.

# v0.7.0

- Add pause-only atomic Google Search campaign create with dedicated budget, PAUSED keyword ad group, keywords and responsive search ads.
- Read back native campaign, budget, keyword and creative state before declaring a write verified.
- Restrict existing paused-campaign updates to name and non-shared budget; reject active campaigns and paid delivery activation.
- Require an explicit non-political advertiser declaration and preserve known native resource identities when submitted writes cannot be verified.
- Route paused campaign mutations through the resolved direct or manager account context.

# v0.6.0

- Reconcile exact Google Ads micro-unit campaign/day cost against account totals before admitting money-out.
- Append immutable reporting corrections, deduplicate source-period imports, and preserve product, account, currency and time-zone identities.
- Keep manually posted spend from overlapping authoritative Google charges and expose revision history beside subscription money-in.

# v0.5.0

- Add read-only Google Ads OAuth authentication, account discovery, native campaign and keyword inventory, and dated spend reporting.
- Preserve account currencies, time zones and exact micro-unit evidence across paginated campaign, keyword and creative views.
- Report expired credentials, incomplete pages and quota limits without inventing commercial values.

# v0.4.0

- Add authenticated read-only Meta account discovery and daily spend reports.
- Preserve exact currency minor units, independent reporting dimensions and source evidence.
- Reject incomplete or unsafe upstream pagination without changing recorded cash.

# v0.3.1

- Stop waiting for quota-exhausted advisory Copilot review during PR delivery.
- Preserve mandatory independent human approval and all nine green CI gates.

# v0.3.0

- Poll Bunny access logs every minute and admit signed subscription receipts and refunds.
- Preserve source request dispositions and inspectable ingestion evidence.
- Reconcile duplicate observations and require complete pages before advancing the poll checkpoint.

# v0.2.0

- Record subscription cash and advertising spend through one authenticated Cloudflare API.
- Deduplicate economic observations and expose exact money-in/money-out totals with provenance.
- Test the real Durable Object runtime before connecting advertising and billing sources.

# v0.1.4

- Put subscription receipts net of refunds and chargebacks minus advertising spend net of credits at the center of marketing decisions.
- Require the smallest demonstrable marketer outcome and one-minute Bunny collection cadence.
- Require early non-draft PRs, frequent status checks, independently approved changes, resolved threads, and all-green CI before merging.

# v0.1.3

- Align disabled review restriction serialization with GitHub's live ruleset output.
- Retain active main-branch checks, independent approvals, and no-bypass protections.

# v0.1.2

- Clarify URL-parameter events collected through Bunny access logs at an approximately five-minute cadence.
- Separate edge acknowledgment, log observation, and durable canonical admission with deduplication and provenance.
- Accept three-day source retention and define late-entry recovery and coverage gaps.
- Require durable rejection dispositions and demonstrated canonical-storage recovery objectives.

# v0.1.1

- Require deterministic budget allocation, keyword pruning, and campaign reconciliation in the first release.
- Record verified Meta capabilities and the remaining positive-keyword dependency.
- Define durable collection and precise Arrow/Polars analytical boundaries.
- Compare implementation stacks and distinguish proposals from selected dependencies.

# v0.1.0

- Establish the Adslop repository and preserve its product specification.
- Adopt scoped delivery, reproducible checks, documentation, and release governance.
- Specialize package identity, ownership, and private-repository setup.
- Synchronize a versioned label manifest without deleting unrelated labels.
- Validate initial package versions against the actual Git baseline.
- Restrict bootstrap to applying reviewed configuration from main.
- Validate private documentation links with repository-scoped credentials.
- Update vulnerable documentation dependencies without lowering audit thresholds.
- Appoint bit-mis for independent owner review and apply the authorized copyright notice.
