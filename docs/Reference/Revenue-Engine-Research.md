# Revenue engine research and proposed stack

Research date: 8 October 2026.

The binding product requirements are in [SPECIFICATION.md](../../SPECIFICATION.md). This record explains external capability findings and a proposed implementation direction. Automated deterministic allocation and campaign reconciliation are required in v1. The production language, storage products, and deployment topology remain decisions for discussion. No advertising account, collector, or optimization engine has been implemented or tested against live campaigns.

## Meta: the required targeting mode is unverified

The reviewed public documentation does not establish a generally available Meta mode combining advertiser-selected positive keywords, matching against a current search query or surrounding text, and the requested creative/targeting behavior. This is a bounded research conclusion. It is not proof that no gated capability exists.

| Mechanism | What the documentation establishes | Consequence |
| --- | --- | --- |
| Facebook Search Results | A search placement; the current API reference requires Facebook feed alongside search | Search inventory is not proof of advertiser-controlled query matching or search-only delivery |
| Instagram Search Results | An `ig_search` placement exists | A placement name does not establish keyword criteria or match types |
| Threads ads | Creation and existing-post promotion document image, video, and image-carousel formats; Instagram feed accompanies Threads feed | The inspected paths do not establish paid text-only contextual advertising |
| Targeting Search | A query discovers interest IDs used in an audience specification | Searching with a keyword is not positive keyword targeting |
| Targeting schema | `keywords` and `contextual_targeting_categories` fields exist | Their presence does not establish serving semantics, eligibility, expansion controls, or matched-context reporting |
| Suitability and blocking | Controls exclude content or publishers | Negative exclusions do not establish positive keyword buying |

The [placement reference][meta-placement], [interest-search reference][meta-search], [Threads creation guide][threads-create], and [post-promotion guide][threads-posts] were read through their complete public Markdown representations. The post-promotion guide accepts Facebook and Instagram media posts and expressly excludes existing organic Threads posts; organic text publishing is therefore not evidence of an equivalent paid format. The [Graph targeting reference][meta-targeting] was available as an official indexed excerpt.

One useful integration failure is documented in the Threads creation guide: an oversized caption can allow object creation for Instagram while preventing Threads delivery. The adapter must separately establish request acceptance, placement eligibility, and observed delivery.

A conforming adapter needs the supported program, placements including mandatory companions, objective, account eligibility, API version, positive-match semantics, format requirements, automatic expansion, budget controls, and accessible delivery evidence. Read-back of a field is only one part of that proof. No authenticated account-level validation occurred in this research.

The current requirement remains unresolved. The available decisions are to retain that requirement while Meta execution stays pending, or explicitly permit a different Meta targeting mode. Keyword-informed creative with Meta audience delivery would be a scope change. It must not be relabeled as keyword targeting.

## Native controls constrain deterministic allocation

Google exposes campaign budgets, including shared and nonshared arrangements. Its current API documentation also supports campaign total budgets for Search with defined start/end times. Meta documents campaign and ad-set budgets; ads consume the enclosing budget. These are control points for allocation, rather than an established per-keyword or per-creative monetary budget. [Google campaign budgets][google-budget] [Meta budgets][meta-budget]

A separately budgeted campaign or ad set containing a creative can provide an independent allocation unit. That structure changes auction interaction and learning conditions, so it must be represented in the experiment. Within a shared native serving unit, an internal creative allocation is a target unless an exposed native control can enforce it. Realized delivery remains an observation.

Daily budgets are not exact same-day ceilings. Google states that most campaigns can be charged up to twice the highest average daily budget selected that day. Meta Business Help currently describes up to 75% above the daily budget and bases the changed-day limit on the highest budget. Its developer budget guide still describes 25%. That discrepancy is unresolved; the lower developer figure is unsuitable as a guarantee. [Google budget changes][google-budget-change] [Meta daily budgets][meta-daily] [Meta budget changes][meta-daily-change]

Meta also documents optional ad-set budget sharing, up to 20%. Isolation requires inspecting and controlling that behavior, not merely selecting ad-set budgets. [Meta budget sharing][meta-sharing]

The engineering consequence is to distinguish desired allocation, authorized exposure, submitted limits, effective native settings, accrued spend, and settled cost. A reduction must not immediately fund another platform while the prior exposure remains possible. Native lifetime/total limits may help constrain a bounded experiment where their current behavior is supported and verified. This research establishes no universal instantaneous-stop or safe hourly-change guarantee.

## A transparent optimization method

The proposed default is constrained marginal-profit allocation over a declared forward horizon. The economic policy in the specification determines which net revenue, fees, refunds, costs, and currency conversions enter contribution profit.

For a native allocation unit, estimate contribution before media cost as a function of the next budget allocation. A piecewise-linear concave response curve permits a linear-program formulation with explicit bounds. Maximize the sum of conservative contribution less media spend and a declared penalty for unnecessary changes. Shared constraints include the remaining authorized envelope, pacing, platform bounds, native increments, fixed experimental commitments, and change limits.

This is an application of established constrained resource allocation. It is optimal only for its input model and assumptions. The [resource-allocation literature][resource-allocation] supports the mathematical approach, not an empirical claim about future Adslop revenue. Concavity and separability require justification within the local spend range. When evidence cannot justify a response estimate, use a bounded collection phase or restrict the change; do not manufacture a curve.

A sorted marginal-tranche method suffices when the constraints reduce to one pooled budget and independent unit bounds. Use a solver when the interacting constraints require it. A pinned serial HiGHS configuration is a concrete candidate: it exposes algorithm, threads, parallelism, seed, presolve, and tolerance settings. Canonical secondary objectives and stable-identity ties must be specified before solving. [HiGHS options][highs]

Mature, comparable cohorts matter. Google documents conversion lag that temporarily distorts CPA and ROAS; fresh missing outcomes are not observed zero returns. [Conversion lag][conversion-lag] Exploration receives a declared budget and maximum loss. A statistically supported economic elimination, a loss-limit stop, and an operational stop have distinct meanings.

Fixed causal comparisons remain protected from ordinary adaptive allocation. If the policy itself is under test, its complete adaptation rule is the treatment. Attributed PnL remains a labeled operational input until an appropriate design supports incremental PnL. These are requirements for scientific interpretation, not a promise that a particular campaign will produce a conclusive result.

## Reconciliation is part of the decision system

Trading-style reconciliation is a good fit for the state and economic discipline: intended actions, external acknowledgments, independently observed state, exposure, financial postings, and unresolved breaks.

The important difference is the evidence granularity. Advertising reports can be delayed or restated aggregates, and attribution is not settlement. A single business purchase may receive credit from multiple platforms. The canonical business ledger must not create extra revenue to match those claims.

The specification therefore requires separate execution, delivery, business-event, and financial records, linked by provenance. Estimates become observed costs through adjustments rather than additional spend; outstanding reservations exclude exposure already counted elsewhere. An account invoice cannot be presented as campaign settlement without a documented allocation. Material breaks restrict increases while protective actions remain available.

Duplicate and out-of-order commerce deliveries are real integration conditions: [Stripe's webhook reference][stripe-webhooks] documents both. This is evidence for idempotent, revision-aware ingestion, not a choice of Stripe as a required v1 commerce provider.

## Meta conversion measurement

A canonical business-event ID should be shared across browser and server representations. Meta's deduplication guide requires matching Pixel `eventID` and CAPI `event_id`, with matching event names, and documents a 48-hour matching window. Adslop still needs its own durable deduplication; platform deduplication is not a substitute for the business ledger. [Meta event deduplication][meta-dedup]

The server-event contract requires the actual occurrence time and source. Automatic subscription renewal has a `system_generated` source, while website events require their source URL. The current contract rejects a request containing an event older than seven days; historical replay must not become an unexamined upload. [Meta server events][meta-events]

Signup, trial, subscription, purchase, renewal, refund, forecast value, and realized receipts remain distinct commercial facts. A website pixel does not establish downstream App Store or Play Store transaction visibility. The generic trusted event interface needs a verified commerce source for those outcomes; store-specific protocols and individual attribution have not been validated here.

For API access, verify the selected app use case, granted scopes, business assets, and account permissions. The current [Marketing API setup matrix][meta-access] is the applicable starting point. Private use does not justify assuming every verification requirement disappears.

## Bunny: query-string events from polled access logs

Mikko's clarified design places the required event fields in the incoming URL query parameters, even when the request method is POST. Adslop polls the access logs approximately every five minutes and accepts their three-day retention. The absence of POST bodies does not invalidate this model: the event representation is in the logged URL.

Bunny's standard v2 `path` includes the query string, and `url` composes scheme, host, and path; extended logging is unnecessary. Use the recommended JSON API v2, because the legacy pipe-delimited export strips literal pipe characters from user-controlled fields. [CDN logging][bunny-logs]

The planned route belongs to a logging-enabled Pull Zone. A thin edge script can validate the query envelope and return the response. Standalone scripts act as the origin for their Pull Zone; they do not require a separate origin server. If a cacheable request variant needs per-request validation, before-cache execution is the documented mechanism. Logging and script execution are separate concerns. [Standalone scripts][bunny-standalone] [Before-cache execution][bunny-before-cache]

The ingestion proposal uses explicit UTC windows, ascending timestamp order, all pages, overlapping reads, and periodic rescans of older windows before expiry. The API exposes `from`/`to`, pagination, request IDs, and optional origin-shield records; its published availability is near real-time. Keep origin-shield records out of the client-event stream. [CDN logging][bunny-logs] A page or completed poll is not a declared immutable source snapshot. Persist retrieved evidence and validated batches before advancing their checkpoints, and retain a separate view of coverage and source maturity. Each source record receives a durable admitted, rejected, or quarantined disposition. Invalid or conflicting public requests retain their evidence and reason while later records continue; quarantined records retain an explicit reprocessing obligation. Checkpoint progress depends on a committed disposition, not successful admission of every request as a business event. Transient failures before any disposition is committed still block progress.

Deduplicate request observations by Pull Zone and request ID. Separately deduplicate canonical outcomes by the declared product/source namespace and stable event ID in the query: a client retry can create another request for the same event. Preserve the returned URL, decoded event, source identity, parser/schema version, and import-batch identity. Compare canonical event content rather than URL parameter order. Conflicting reuse fails explicitly; legitimate corrections have revision identity.

The states are request handled at Bunny, log record observed by Adslop, and event durably admitted into Adslop. Canonical admission commits validated event content, identity, receipt, and provenance together. It happens during ingestion, so this design does not require a synchronous database write before the edge response. Recovery recognizes already-admitted events and recorded rejection or quarantine dispositions. Before canonical storage is selected or deployed, declare the production failure model and measurable loss/recovery objectives for events, evidence, dispositions, and checkpoints. Validate them across the relevant interruption, storage-failure, and primary-failover paths, including after the provider's source copy expires. A checkpoint cannot recover ahead of the retained data and dispositions it covers. After admission, replay relies on Adslop's retained evidence under that contract.

The approximately five-minute schedule and three-day source retention provide a practical retrieval and recovery window. Monitor ingestion lag, failed polls, pagination completion, and the oldest unimported interval with margin before expiry. Revisit windows for late entries. An expired or unavailable interval is a coverage gap, not zero conversions. A numeric maximum publication delay, logged-URL length/truncation limits, and the original-versus-rewritten URL logging stage were not established in the inspected references. Verify query round-trip fidelity, encoding boundaries, and observed publication behavior on the configured route. The schema supports the proposal; no account-level collection test has occurred.

Optional UDP forwarding and Permanent Log Storage have their own delivery and rotation limitations. Their documentation directs precise reporting to the Logging API or Statistics API; those optional-path warnings must not be transferred into an assertion that the selected HTTP API has the same loss behavior. [Forwarding][bunny-forwarding] [Permanent storage][bunny-permanent] No inspected contract makes the original edge response a durable Adslop admission receipt.

Bunny advertises a 14-day trial and a $1 monthly minimum. Scripting costs are published as $0.20 per million requests plus $0.02 per 1,000 CPU seconds, with billing increments and CDN bandwidth additional. These are input prices, not an Adslop cost estimate. [Edge Scripting][bunny-edge] [Scripting pricing][bunny-pricing] No account or deployment was created in this research.

The product used for canonical storage remains a separate decision. A transactional store such as PostgreSQL is a candidate for admitted events, command work, and reservations; its actual synchronous-commit, replication, and failover configuration must satisfy the chosen recovery objectives. [PostgreSQL WAL settings][postgres-wal] Bunny Database is a different product from CDN logs and currently documents possible loss of recently acknowledged writes on primary failover. That finding matters only if it is considered as the canonical store. [Bunny Database durability][bunny-db]

## Arrow, Polars, DuckDB, and storage

The requested direction is sound when expressed as typed columnar data and efficient native execution. It is not an end-to-end promise that no bytes are ever copied.

| Boundary | Accurate contract |
| --- | --- |
| Arrow C/PyCapsule | Compatible buffers can be shared within one process; this is not persistence or network transport |
| Uncompressed local Arrow IPC | A compatible reader can reference mapped buffers; I/O and page faults still occur |
| Polars/Arrow interchange | Often zero-copy; incompatible types, rechunking, or contiguous conversion can allocate |
| Native Polars expressions | Work executes in the native engine; new values and many transformations still require computation and output buffers |
| DuckDB execution | Arrow integration is available, but DuckDB internally uses its own vectors and data chunks |
| Parquet archival | Encoding/compression and decoding are materialization boundaries; a Parquet file is not a mapped Arrow buffer |

Sources: [Arrow C interface][arrow-c], [Arrow IPC][arrow-ipc], [Polars Arrow interchange][polars-arrow], [DuckDB vectors][duckdb-vector], [DuckDB/Polars integration][duckdb-polars], and [Arrow's Parquet guide][arrow-parquet].

The proposal is Arrow batches for analytical contracts, native Polars expressions for transformations, DuckDB for SQL inspection and selected ingestion/query work, and partitioned Parquet for cold analytical storage. Uncompressed IPC can serve warm caches and interchange. Avoid repeatedly converting through Python row objects or moving every transformation between two engines.

This explicitly differs from requiring every on-disk analytical artifact to be Arrow IPC. If that literal requirement is retained, choose IPC archives and evaluate their storage and decoding tradeoffs. Parquet has not been silently approved.

DuckDB's native storage is not the multi-process transactional command service. Its current concurrency documentation distinguishes an embedded writer from multi-process access and marks the newer multi-process path as beta. [DuckDB concurrency][duckdb-concurrency] The command ledger and analytical engine have different consistency and recovery jobs.

## Language and stack recommendation

| Option | Assessment for this first release |
| --- | --- |
| Python application + Polars | Recommended starting point: concise adapters and orchestration, strict interfaces, native analytical execution |
| Python + targeted custom Rust | Recommended extension path when profiling or resource control identifies a concrete need |
| All Rust application | Viable, but additional implementation and integration work needs a demonstrated benefit; it does not remove economic or external-consistency errors |

Polars already implements its engine in Rust and provides its own compute and buffer implementations. Python expressions can therefore describe native work without moving analytical loops into Python. [Polars overview][polars] A custom Rust [expression plugin][polars-plugins] can extend that path without a wholesale application rewrite.

My recommendation is a modular Python API and workers, transactional event/outbox/reservation storage, native Polars analytics, a pinned optimization solver, and DuckDB for analytical SQL. Keep the planned Bunny TypeScript edge entry point thin. The human UI remains a separate client of the same API; this backend recommendation does not imply writing a browser application in Python.

Rust is appropriate for a measured parsing, collection, or custom-kernel bottleneck, or a component whose ownership/resource guarantees justify the added boundary. Begin with native libraries and ordinary compiler optimization. Hand-written intrinsics need profiling, semantic-equivalence evidence, and portable fallback behavior; Rust's own [SIMD guidance][rust-simd] recommends profiling first.

This is an engineering judgment, not a benchmark result. The first reliability proofs are durable acceptance, atomic reservation, idempotent execution, revision-aware ingestion, reconciliation, safe replay, and restoration. Numerical decisions require explicit rules regardless of language. No measured evidence presently establishes a need for custom SIMD or an all-Rust rewrite.

[meta-placement]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/placement-targeting.md
[meta-search]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/reference/targeting-search.md
[threads-create]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-creative/threads-ads/creation.md
[threads-posts]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-creative/threads-ads/creation/use-posts-as-ads.md
[meta-targeting]: https://developers.facebook.com/docs/graph-api/reference/targeting/
[google-budget]: https://developers.google.com/google-ads/api/docs/campaigns/budgets/overview
[meta-budget]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets.md
[google-budget-change]: https://support.google.com/google-ads/answer/10487143
[meta-daily]: https://www.facebook.com/business/help/190490051321426
[meta-daily-change]: https://www.facebook.com/business/help/525189242169568
[meta-sharing]: https://www.facebook.com/business/help/1388266028979935
[resource-allocation]: https://web.stanford.edu/~boyd/papers/resource_alloc.html
[highs]: https://ergo-code.github.io/HiGHS/dev/options/definitions/
[conversion-lag]: https://support.google.com/google-ads/answer/9347141
[stripe-webhooks]: https://docs.stripe.com/webhooks
[meta-dedup]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events.md
[meta-events]: https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event.md
[meta-access]: https://developers.facebook.com/documentation/development/create-an-app/marketing-api-use-cases.md
[bunny-standalone]: https://bunny.net/docs/scripting/standalone/overview
[bunny-before-cache]: https://bunny.net/docs/scripting/before-cache
[bunny-edge]: https://bunny.net/edge-scripting/
[bunny-pricing]: https://bunny.net/docs/scripting/pricing
[bunny-logs]: https://bunny.net/docs/cdn/logging
[bunny-forwarding]: https://bunny.net/docs/cdn/logging/forwarding
[bunny-permanent]: https://bunny.net/docs/cdn/logging/permanent-storage
[bunny-db]: https://bunny.net/docs/database/durability-and-consistency
[postgres-wal]: https://www.postgresql.org/docs/current/runtime-config-wal.html
[arrow-c]: https://arrow.apache.org/docs/format/CDataInterface.html
[arrow-ipc]: https://arrow.apache.org/docs/python/ipc.html
[polars-arrow]: https://docs.pola.rs/user-guide/misc/arrow/
[duckdb-vector]: https://duckdb.org/docs/current/internals/vector
[duckdb-polars]: https://duckdb.org/docs/current/guides/python/polars
[arrow-parquet]: https://arrow.apache.org/docs/python/parquet.html
[duckdb-concurrency]: https://duckdb.org/docs/current/connect/concurrency
[polars]: https://docs.pola.rs/
[polars-plugins]: https://docs.pola.rs/user-guide/plugins/expr_plugins/
[rust-simd]: https://rust-lang.github.io/packed_simd/perf-guide/prof/profiling.html
