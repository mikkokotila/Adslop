# Adslop: prose specification

Initial specification, 8 October 2026.

This document records the product requirements established with Mikko Kotila and the engineering behavior needed to make those requirements concrete. It describes the intended system; it does not claim that the system or its platform integrations already exist. Requirements established in the interview are distinguished from implementation decisions and unresolved external capabilities where that distinction matters.

## Purpose

Adslop is an instrument for generating incremental revenue from digital products. It gives a sophisticated advertising operator a unified way to set up, run, manage, optimize, and understand revenue campaigns. Its immediate area of mastery is keyword-based advertising. The product should concentrate expertise into a clear, powerful application whose underlying engine is dependable enough for systematic experimentation and eventual autonomous operation.

The initial operator has thirty years of experience in advertising technology. Adslop should support precise work at that level: explicit controls, fast inspection, bulk operations where useful, reliable comparisons, and direct access to evidence. Its human interface should be a high-quality application with a coherent working model. Routine work should require little navigation, while the exact meaning and consequences of a decision remain inspectable.

Digital products are first-class inputs. A product can have several destinations, offers, purchase models, conversion events, and revenue horizons. The Four Pillars/BaZi application is the first motivating use case: acquisition can lead through a website or an app store to signup, free use, and subscriptions. Those details illustrate one integration. Product identity, subscription tiers, billing periods, prices, and funnel stages must remain configurable rather than becoming assumptions embedded in the advertising engine.

The long-term direction is a complete revenue loop in which agents can conduct experiments across advertising, landing pages, offers, and eventually product development. The first release establishes the reliable advertising and measurement foundation for that direction. API-first design makes the same instrument available to humans and agents from the beginning.

## The first accepted release

The first accepted release must let the operator create one campaign and run it across two advertising platforms through a unified experience. The initial platform targets are Google and Meta. The application must account for each platform's capabilities and keyword-matching behavior, install or connect conversion tracking, and present the performance of the resulting ads. Campaign management, tracking diagnostics, and evidence inspection must be part of that usable experience.

The operator defines the commercial intent once. The system turns that intent into inspectable platform-specific campaign definitions, validates them, and coordinates their execution. The human interface and the agent interface must both support this complete workflow through the same API. An initial implementation may develop one adapter first, but acceptance of the first release requires verified operation on both selected platforms.

The release includes an experimental foundation: versioned manifests, traceable interventions and observations, a supported controlled-comparison workflow, and reproducible evaluation. It must be useful for everyday campaign creation and performance measurement even when an experiment has not accumulated enough evidence for a causal conclusion. Insufficient evidence is a valid result that the application must represent accurately.

The first release serves one private operator across multiple products, campaigns, and advertising accounts. It should have clear ownership boundaries that allow the software to be shared and deployed by other operators later. A hosted service for multiple independent tenants, autonomous application development, and a comprehensive library of commerce integrations are subsequent scope.

## Campaign intent and keyword semantics

A campaign represents an operator's commercial intent: the product and destination being promoted, the intended outcome, the terms and contexts in which an ad should be eligible, its message, its operating period, and its allocation of spend. Native campaigns, ad groups or ad sets, keywords, ads, and tracking identifiers are linked implementations of that intent. The system must retain those links through revisions and reporting.

Keywords are targeting inputs. In the initial model, an advertiser selects positive keywords that constrain eligibility against a search query or the text of a content context. Negative keywords and supported matching controls refine that eligibility. Looking up an audience category by typing a word does not establish this targeting relationship. Adslop's initial scope excludes constructing and selecting behavioral, interest, cookie-based, or retargeting audiences as substitutes for the keyword requirement.

The keyword model must preserve each platform's actual semantics. A match type with the same label on two platforms need not have identical behavior. Close variants, expansion, negative matching, normalization, language, eligibility, and exclusions must be represented according to the adapter's verified capabilities. The system must expose consequential differences before publication and record the native settings used. A transformation that changes the declared targeting intent requires an explicit revision rather than an invisible fallback.

Adslop must also distinguish a requested keyword from an observed search term or content match. Reports should show that relationship when the platform supplies it, along with unavailable or suppressed information. An unreported query is unknown evidence, not a zero-result query. Platform use of additional internal delivery signals must be described to the extent it is known; the system cannot claim complete visibility into a platform's auction or personalization machinery.

Text advertising is the intended initial creative focus. The common authoring experience captures the message, its variants, destination, and relevant assets, then validates the native formats. If a placement requires media or other material beyond the shared text, the requirement must be visible. The interview expressed text ads targeted on text as the preferred model. The authoring experience should minimize additional creative work and expose native asset requirements. A placement may require an image alongside the text; that requirement is an explicit format difference included in the reviewed creative, while positive keyword targeting remains the essential targeting condition.

## Platform capability and the Meta dependency

Google describes Search campaigns as text ads on search results for which advertisers write copy and select keywords. That is the verified reference implementation for the initial targeting and creative model. The Google adapter must make network selection explicit, so the operator knows which inventory is authorized by the campaign. The current first-release scope is Google and Meta; Bing and a separately managed YouTube channel are outside it. [Google campaign types][google-campaigns]

Meta remains a required integration target with an unresolved capability dependency. Research on 8 October 2026 identified Facebook Search Results as the closest relevant placement. Meta's published guide documents image ads for Traffic and carousel ads for App Installs there. Those sources establish available media-based formats; they do not establish that an advertiser can select positive keywords controlling the current search or content context. [Meta Search image format][meta-search-image] [Meta Search carousel format][meta-search-carousel]

The current Graph API targeting reference and Meta's official API examples contain a field named `keywords`; the targeting reference also lists contextual categories. A field name or successful request does not establish its supported serving semantics, placement eligibility, or availability to a particular advertiser. These details must be verified before the adapter claims conformance. [Meta targeting reference][meta-targeting] [Meta API examples][meta-api-examples]

Threads is another text-rich surface, but Meta's 2026 announcement describes personalized delivery with image, video, and carousel formats. Its later content-blocking announcement describes categories of adjacent content to avoid. Those announcements do not establish positive keyword buying against surrounding text. [Threads advertising][threads-ads] [Threads content controls][threads-controls]

Before Meta execution can satisfy acceptance, a capability investigation must establish the supported program and placement, actual keyword input and matching behavior, creative requirements, account eligibility, automation access, unavoidable expansion, and the evidence available to verify delivery. A conformance record must identify its documentation, API version, date, relevant account conditions, and the results of safe validation. Some public Meta material was available only as indexed official excerpts during this specification's research; account-level behavior has not been validated.

If that investigation cannot establish a conforming Meta mode, the original two-platform acceptance condition remains unresolved. The operator must make a recorded scope decision about the targeting model, a different platform, or release scope before that condition can change. The specification does not silently substitute audience targeting, replace Meta with Bing, or declare a single-platform build complete. Work on common plumbing and the Google adapter can proceed while this dependency is resolved.

## The unified creation and management experience

The operator begins with a product, destination, desired outcome, keyword set, text, budget, and schedule. The application supports efficient entry, reusable components, and deliberate variants without requiring the operator to recreate the same intent separately for each platform. Every executable campaign revision must be bound to a pinned experiment manifest. A campaign may join an existing experiment or be created together with a new one. Initial baseline collection can be a declared stage of a manifest, with its purpose and limits on interpretation made explicit.

The budget is an overall authorized spend envelope with explicit allocations across platforms and accounts. The prepared plan shows both the total and its native allocations, with currency and period defined, and validates that the allocations remain within the envelope. Shared authoring must not duplicate the full budget onto each platform. Manual allocation is sufficient for the first release; an automatic allocation engine is subsequent capability.

The campaign workspace presents a common definition alongside its native realizations. Shared edits propagate into a new proposed revision. Platform-specific overrides are explicit, traceable, and shown in a concise difference view. The interface should reveal required differences at the point of decision, rather than making the operator navigate unrelated native-platform settings to discover them.

Before a campaign is executed, validation covers targeting and creative compatibility, account access, destination and tracking readiness, schedule, budget, and experimental consistency. Validation produces structured results that identify errors, relevant limitations, and the exact configuration being checked. A prepared plan can be inspected through either interface. If a material configuration changes after validation, the affected plan is revalidated.

Publication is one coordinated operation with separately observable platform results. The plan should prepare native resources in a non-serving state where supported, verify their configuration, and then request activation according to the declared schedule and execution policy. Creating an object, receiving platform approval, enabling it, and observing actual delivery are distinct states.

Simultaneous operation means that one intent and schedule coordinate both platforms. External APIs do not supply Adslop with a shared atomic transaction or a guarantee that review and delivery begin at the same instant. The system records each platform's timestamps, acknowledgments, review status, effective settings, and observed serving state. A partial result remains visible and recoverable. The default policy should avoid deliberately activating one side after preparation of the other has failed; any allowed partial operation must be explicit in the plan.

Ongoing management includes inspecting status, pausing and resuming, revising budgets and schedules, managing keyword and negative-keyword sets, and preparing new creative or targeting variants. Changes link to their actor, reason, prior state, manifest, and resulting native operations. An emergency stop remains available without waiting for a scientific decision, and its effect on an ongoing experiment is recorded.

## One API for human and agent operation

The supported API is the application boundary for every substantive operation. Product setup, account connection, campaign authoring, validation, execution, management, experiment definition, tracking configuration, measurement, and audit inspection must all be available through it. The human application and agent-facing tools are clients of these capabilities.

Humans and agents receive the same semantics, validation, visibility, and authority checks. A capability must not depend on an undocumented user-interface action. An agent must not receive a hidden execution path that bypasses the rules applied to a human. Authentication methods may differ, but both kinds of principal operate through an explicit identity and granted scope.

The API must provide versioned, machine-readable contracts, stable resource identities, structured errors, and documented state transitions. Long-running work returns an operation identity that can be inspected until its outcome is established. Paginated collections, filters, incremental event access, and machine-readable reports must make routine automation practical. Mutating operations require a supported duplicate-prevention mechanism and concurrency checks where an intervening revision would change their meaning.

The agent interface should expose coherent tools for the same tasks a human performs. It may offer concise summaries and structured action plans, while retaining access to exact evidence. Fully autonomous strategy generation is not required to achieve this interface parity. The first release must already permit an authorized agent to perform an ordinary supported campaign workflow through the API.

Authority is configured explicitly. An approved manifest or execution plan may carry standing permission to act within specified accounts, allocations, periods, and operation types. The system evaluates that permission at execution time, including revocation and expiry. Increasing authority or changing the approved operating envelope is a separate recorded action. API-first parity applies to approval and policy administration as well as campaign execution; granted roles determine who may perform them.

## Event sourcing and provenance

The durable record of the system is its event history. Authoritative state changes are recorded as events, and current views are derived from that history and versioned source observations. A dashboard, aggregate, or mutable projection must not become the only surviving explanation of a material decision. Events cover product and campaign definitions, experiment and release revisions, authority changes, commands, execution attempts, platform responses, tracking observations, measurement imports, corrections, analyses, and decisions.

Each material event must be attributable to an identity and source, with an event identity, occurrence and receipt times where available, a schema version, and links to the relevant product, campaign, operation, manifest, and software release. Correlation and causation links connect a request to attempts, acknowledgments, observations, and derived results. Native platform identifiers and provider request identifiers are retained when supplied. Automated or agent-generated decisions also identify the relevant tool, policy, model or prompt configuration, and recorded inputs to the extent available and appropriate.

The history must represent what Adslop actually knows. A requested action, an attempted request, a platform acknowledgment, and an independently observed resulting state are different facts. A timeout may leave an unknown outcome. An aggregate report does not become a set of individually observed impressions. Provenance must include gaps, redactions, late arrivals, and external limitations rather than filling them with inferred certainty.

Events and source records require integrity protection, versioned interpretation, and a durable retention strategy. Referenced payloads and artifacts should have content identities so analyses can identify the exact evidence they used. Corrections append new evidence or a superseding interpretation, preserving why an earlier result changed. If a platform revises yesterday's spend, the system retains both the previous observation and the correction, with appropriate effective times.

Projections must be rebuildable, with clear processing checkpoints and freshness indicators. Event ordering must be defined for the entity or operation that needs it; a fictitious total ordering across independent external systems is unnecessary. Schema evolution must allow old records to remain interpretable, with explicit migrations or versioned readers. Reprocessing must identify the transformation version and the evidence boundary used.

Full provenance applies to accessible evidence and Adslop's behavior. It does not authorize storing credentials, tokens, unnecessary personal data, or every internal state of an external platform. Sensitive payloads should be isolated from durable audit metadata with explicit retention and deletion behavior. Any removal or redaction affecting reproducibility must itself be recorded, so an auditor can understand the resulting limit.

## Experiment manifests and scientific work

Systematic experimentation is the organizing discipline of Adslop. Creative, keywords, matching strategies, spend allocation, and the system's own features are interventions whose effects should be investigated through explicit comparisons. Operational metrics remain useful observations; a claim of incremental effect requires an appropriate counterfactual and an evaluation that supports that claim.

Every experiment has a durable identity and a versioned manifest. The manifest establishes the question, hypothesis, causal contrast being estimated, intervention, comparison or control condition, eligible population or inventory, experimental unit, assignment method, affected platforms and resources, outcome definitions, evaluation horizon, and operating limits. It also identifies important exclusions, guardrails, planned analysis, stopping or review rules, and the versions of configurations and artifacts required to interpret the result. Fields appropriate to a design must be explicit; a generic form should not invent randomization where none exists.

The manifest must be inspectable before exposure begins. It specifies the outcome evidence required across the analysis population, including the comparison group. Outcome collection must not silently exclude a person or region because there was no ad click or intended exposure. A supported design may use documented aggregate evidence instead of individual records. If the required comparison or outcome coverage is unavailable, the causal effect is not estimable under that design; this differs from a valid experiment that remains statistically inconclusive.

Once execution starts, the original definition is preserved. Amendments become new revisions with effective times and an explanation of their consequences for interpretation. A substantial change may require a new experiment. The system must expose departures from the planned comparison, including manual interventions, platform-side changes, unexpected overlap, delayed activation, or an interrupted control condition. Emergency and corrective operations append the resulting deviation to the affected record and can proceed under their existing operational authority without requiring a new scientific hypothesis.

Assignment and exposure are separate evidence. When Adslop controls assignment, it must record the unit, rule, and reproducibility information required to explain it. When a platform controls assignment or reports only aggregates, the manifest records that dependency and the available evidence. Rejected ads, failed delivery, and platform learning can alter exposure without changing the originally assigned treatment. The evaluation must use a stated estimand and handle those differences consistently with the design.

The first release must support a concrete controlled-comparison workflow through its manifests and execution model. The precise mechanism must fit the verified platform controls and available outcome data. Appropriate possibilities include a supported native experiment, geographic randomization, or a justified time-based design; these are distinct methods with different assumptions. A before-and-after comparison is observational unless the design and assumptions justify a stronger interpretation.

Experiments running across two platforms require explicit handling of overlap. A person or region may be exposed through both channels. The platform dimension can be a stratum or part of the treatment definition, depending on the question. The system must not add two platform lift estimates and present the sum as a combined causal effect without a valid design for that inference. Concurrent tests require declared compatibility or exclusion rules to prevent uncontrolled interaction.

Evaluation records the actual evidence window, population, transformations, method and version, estimates, uncertainty, and relevant diagnostics. It must distinguish an inconclusive result from evidence of no meaningful effect. If evidence is insufficient, the result remains inconclusive under the declared rules. Selecting a winner, extending a study, stopping it, or applying a finding creates a recorded decision with its rationale and authority.

The same discipline applies to Adslop's features. A software change carries a release manifest and a stated validation or experiment plan appropriate to the claim being made. Deterministic correctness checks, reliability exercises, usability studies, and causal revenue experiments have different evidential roles. The system should preserve those roles. A single initial operator may not provide enough independent observations to estimate the revenue impact of every interface change; that limitation must remain visible rather than converting ordinary engineering validation into a causal claim.

## Releases and repeatability

Every deployed release has a manifest linking its source revision, build artifact, material dependency versions, configuration references, event and API schemas, platform adapters, measurement definitions, and analysis implementations. A result or action must be traceable to the release that produced it. Secrets are referenced by identity or version without being embedded in the manifest.

Repeatability means that an authorized investigator can recover the declared inputs, reconstruct relevant state, and recompute supported results using the recorded versions. Randomized procedures retain their assignment records and required seeds or algorithm versions. Agent and model interactions retain sufficient inputs, outputs, and provider metadata to explain the recorded decision, while acknowledging that a future call to an external model may not reproduce the same output.

Replaying recorded history must be safe by construction. State reconstruction and analysis cannot resend live campaign writes, emit duplicate conversion uploads, or cause spend. A new external action requires an explicit new execution context and authority. Repeating an experiment in a later market is a new experiment linked to the original; it creates fresh evidence rather than reproducing historical auction outcomes.

The foundation should make inspection and replay ordinary product capabilities. The operator should be able to move from a displayed result to its outcome definition, source observations, manifest, and release, and obtain a reproducible analysis package when the relevant data is retained. If a dependency or source payload is unavailable, the package identifies the missing component and which results can still be reconstructed.

## Reliable execution and reconciliation

The command path must durably connect accepted intent to execution work. Recording an accepted command and scheduling its work must survive a process failure without leaving an untracked external operation. A transactional event-and-work pattern, or an equivalent mechanism with the same guarantees, should make this behavior explicit. Background workers may retry transient failures, but every attempt remains linked to the original operation.

Duplicate prevention must cover both inbound requests and outbound platform operations. Native idempotency support should be used where available. Where it is absent or insufficient, Adslop needs stable mappings, guarded transitions, and reconciliation before retrying an ambiguous write. The system must not promise exactly-once behavior across APIs that do not offer it; it must demonstrate that uncertainty and duplicate risk are controlled and visible.

Adapters reconcile intended, acknowledged, and observed state. They must detect manual edits made through native interfaces and record drift before enforcing or incorporating a change according to policy. Rate limits, expired credentials, review delays, rejected creatives, unavailable features, and interrupted network requests require actionable states. Silent retry loops must not hide a campaign that is incomplete or no longer authorized to run.

Cross-platform failures use explicit recovery or compensating actions. If one platform starts serving while the other fails, the system records the exposure and spend that already occurred, applies the declared partial-launch policy, and offers a traceable path to repair or pause. A compensating pause cannot erase prior delivery or restore an experiment's counterfactual retroactively. The experiment record must reflect the interruption.

Limits are enforced at the campaign, experiment, platform, and applicable operator allocation. The system should reject a proposed plan that exceeds its authorization and should react conservatively to stale or unknown spend. Native budget controls, Adslop's allocations, measured spend, and estimated accrued spend must remain distinguishable. Reporting delays and external platform behavior limit the precision of instantaneous spend caps; the interface must describe the actual guarantees rather than imply that an API-side stop can prevent every overrun.

## Conversion tracking and outcome evidence

The first release includes a straightforward browser tracking integration and a secure server event interface. A product should be able to register a conversion definition, connect a pixel or equivalent browser instrument, send a test event, and inspect whether collection and campaign association work. The API exposes this setup and diagnostics to agents as well as the human interface.

Conversion definitions are versioned. Signup, activation, purchase, subscription start, renewal, cancellation, and refund are different event meanings that a product can supply as needed. The platform should permit custom outcomes without embedding a particular app's funnel. Events identify the product, event type and version, time, source, relevant transaction or event identity, and optional value and currency. A minimal valid conversion does not require a full customer profile.

Browser collection is untrusted input. It must not expose platform credentials or grant access to campaign management. Collection identifiers identify the permitted destination and scope. Input validation, request limits, origin controls where applicable, and abuse detection protect the collector, while trusted server integration provides stronger evidence for commercial events. Source confidence must remain inspectable rather than treating all pixel events as confirmed payments.

Campaign links can use supported click identifiers, destination parameters, first-party session relationships, and other explicitly permitted evidence. Product outcome collection must also accept events without an ad association, so organic outcomes and control-group evidence can support a declared analysis. Conversion collection and audience targeting are separate concerns: product outcome events are necessary for measurement even though behavioral audience construction is outside the initial targeting scope. Collection should be purpose-limited, honor the product's consent and retention configuration, and avoid capturing sensitive form contents or unnecessary URL parameters.

Browser and server reports of the same outcome require deduplication. A stable product-scoped event or transaction identity must support one canonical outcome while preserving both observations and their sources. Retries, out-of-order events, refunds, and corrections must update derived results without destroying the earlier evidence. The source and definition that establish a counted commercial event must be explicit.

A browser pixel alone cannot establish every downstream transaction in a native app or external checkout. Products may provide server-side events or connect a suitable source of commercial records. The first release requires the generic interfaces and at least one working tracked conversion path, rather than bespoke connectors for every app store, payment service, or subscription system. Missing, delayed, aggregated, or unlinked outcomes remain distinguishable in reporting.

Forwarding a conversion to an advertising platform is a separate recorded operation. Collection by Adslop, an upload attempt, platform acceptance, and appearance in a platform report are different states. Any such forwarding must use a verified adapter contract and the appropriate product configuration. An upload acknowledgment alone does not prove that the platform attributed or counted the event.

## Performance measurement and incrementality

The operator must be able to assess delivery and commercial performance by unified campaign, platform, native entity, keyword, creative revision, and experiment wherever the underlying data supports those dimensions. The initial measures include available impressions, clicks, spend, tracked conversions, attributed conversions, attributed revenue, and the corresponding rates and cost or return measures. Every derived metric must have a clear definition, denominator, time basis, and provenance.

The system maintains a distinction among platform-reported delivery, product-observed outcomes, attributed performance, and experimentally estimated incremental effects. A conversion associated with a click is evidence for an attribution rule; estimating the causal effect of advertising requires the declared comparison. Google's own Experiment Center distinguishes comparative experiments from lift studies, and its Conversion Lift documentation describes treatment and unexposed control groups. Native lift capabilities are not available to every account. [Google Experiment Center][google-experiments] [Google Conversion Lift][google-lift]

Unified reporting must preserve differences that affect interpretation. Platform attribution windows, click-through and view-through credit, reporting dates, conversion definitions, modeled values, time zones, currency, and freshness must be explicit. Comparable values can be combined only under a stated normalization. Native figures remain available beside normalized results so the operator can explain discrepancies.

One product outcome may be credited by both platforms. Cross-platform totals must use a defined deduplicated outcome source or display the overlap limitation. Adding platform-attributed revenue and labeling it unique revenue would produce a misleading measure. Unattributed revenue, refunds, renewals, and delayed outcomes must have defined treatment under the selected metric and horizon.

Money is represented with currency and suitable decimal precision. Currency conversion, if used, records the rate source and applicable date. Revenue, collected amounts, refunds, advertising cost, and any product-supplied variable cost must have distinct meanings. The manifest or reporting definition selects the economic objective and observation horizon; the engine does not hard-code one product's pricing or assume that short-term attributed ROAS measures long-term incremental value.

Reports show the evidence available as of a particular processing point. Late events and revised platform data create a newer result while preserving the prior result's evidence boundary. Missing data is not silently represented as zero. The operator must be able to distinguish a performance change from a change in tracking, source freshness, interpretation, or software.

## Optimization and the path to a full loop

Optimization proceeds through recorded, testable interventions. A creative recommendation identifies what is changing and the comparison that will evaluate it. Keyword additions, exclusions, matching changes, and allocations follow the same principle. A decision to apply a result identifies its evidence, relevant uncertainty, constraints, and authority.

The first release supplies the execution, measurement, and experiment mechanisms through which an operator or authorized agent can conduct this work. It need not independently invent and govern a complete advertising strategy. Subsequent releases can add research agents, candidate generation, experiment scheduling, and policy-controlled application of findings without creating a separate unrecorded path around the foundation.

Landing-page changes, offer and pricing experiments, and application development are future extensions of the same manifest, authority, event, and evidence model. Their data contracts and experimental units will differ, but their actions must remain inspectable and attributable. These future capabilities must not make the first advertising workflow depend on a general-purpose autonomous development system.

## Human experience and operational visibility

The human application should make a small number of central objects easy to work with: products, unified campaigns, experiments, operations, and evidence. A campaign view should answer what was intended, what is configured on each platform, whether it is serving, what it costs, what outcomes have been observed, and what requires attention. An experiment view should explain its question, current comparison, progress, and available conclusions.

The interface should support efficient editing and comparison for an expert. Native differences are presented when relevant, shared work stays shared, and advanced inspection is accessible without dominating routine operation. Tables, filters, histories, and precise drill-downs should support real management work. A conversational agent surface may complement this interface, while the core application remains directly operable.

Operational health is part of the product. The operator needs visible tracking diagnostics, event-ingestion freshness, source synchronization progress, rejected or unknown operations, campaign drift, and spending alerts. The interface must distinguish a platform issue, an Adslop execution issue, and an absence of sufficient measurement evidence. Every alert should point to the relevant operation or source record and an available recovery path.

The application must retain actor accountability even while it initially serves one person. Account credentials and integration secrets remain outside ordinary event payloads and reports. Access can be revoked, source connections can be replaced, and an operator can halt new execution. Human and agent identities are visible in the same history.

## Foundation, development, and open-source direction

The initial architecture should favor a small, understandable set of components with explicit boundaries: the API, durable event and configuration storage, background execution, platform adapters, collection and measurement, and human and agent clients. A modular application with durable transactional storage is an appropriate starting design. Distributed infrastructure is justified by demonstrated needs rather than by the eventual breadth of the vision. The language, database product, deployment provider, and specific agent framework are implementation choices to record separately.

Reliability must be demonstrated through the failure cases that threaten this product. Accepted intent must survive interruption; retries must not create duplicate campaigns or duplicate commercial outcomes; ambiguous writes must reconcile; projections must rebuild; and replay must not emit live side effects. Backup and restoration must preserve the relationships among events, referenced evidence, manifests, configuration, and secrets management. Operational recovery procedures belong with the software.

Delivery should proceed through verifiable increments: establish the contracts and event model, prove local and simulated execution, implement a verified adapter, add conversion collection and measurement, then demonstrate coordinated operation across both required platforms. The experimental and release records accompany those increments. An internal milestone can be useful while a release dependency remains open, but its status must be accurately named.

The repository begins privately at `mikkokotila/Adslop`. The software is intended for open-source development and gradual use by other experienced operators. Deployment documentation, understandable module boundaries, versioned contracts, reproducible builds, and realistic examples should make that progression possible. Private credentials, customer data, and live operational state must remain separate from the distributable project.

The initial interview did not select an open-source license, hosting provider, or technology stack. These decisions should be recorded before they become dependencies; a suitable license is required before a public open-source release. This specification does not change the repository's private visibility or authorize publication of operational data.

## Acceptance and unresolved decisions

Acceptance requires a real operator or an authorized agent to define one campaign through the common API, inspect conforming native definitions for both Google and Meta, and coordinate publication on both. Both platform results must be visible, correctly linked, and manageable. An unsupported capability or partially completed operation must produce an accurate, actionable state. The same representative product conversion path must be exercised from each platform's native campaign. This must demonstrate collection, duplicate handling, and the supported linkage into the resulting report, with uncertainty or unavailable linkage identified wherever the evidence imposes that limit. One product integration exercised across both platforms is sufficient for this acceptance scenario.

The same scenario must be available through the human application and the agent interface. Validation and authority decisions must agree across them. Repeating an idempotent request must return or converge on the same intended operation rather than creating a second campaign. A failure between platform operations must remain recoverable without concealing any delivery that already occurred.

Measurement acceptance requires correct deduplication, clear metric definitions, explicit currency and time handling, and reproducibility of a report from its recorded evidence and software versions. A controlled experiment must connect its manifest, actual intervention and exposure evidence, evaluation, and decision. A valid inconclusive result satisfies the scientific behavior requirement; a statistically significant improvement is a business outcome that cannot be guaranteed by software acceptance.

Reliability acceptance requires demonstrated safe replay, reconstruction of relevant state, recovery from interruption and ambiguous external outcomes, and traceability of a displayed result to its source and release. Implementation must establish suitable operating limits and observable service objectives before live use. Numerical targets should be chosen against the actual deployment and load rather than invented in this initial prose specification.

The material external dependency is Meta's conformance to positive keyword targeting and the required operational workflow. Creative asset requirements are explicit adapter differences within the unified authoring experience. The requirement for two platforms remains binding until fulfilled or explicitly revised. Routine configurable choices such as products, keywords, budget values, attribution definitions, and outcome horizons belong in campaign or experiment configuration. The technical design may now proceed from this specification without reopening the product interview for ordinary engineering choices.

## Sources and evidence limits

The product requirements originate in the founding interview with Mikko Kotila on 8 October 2026. The sources below support factual statements about external platforms. They do not establish account-specific access or replace an adapter capability check. Platform details may change and must be revalidated against the API version used by an implementation.

1. [Google Ads: Choose the right campaign type][google-campaigns]. Read on 8 October 2026; describes Search text ads and keyword selection.
2. [Meta: Traffic image ad specifications on Facebook Search Results][meta-search-image]. Official indexed excerpt read on 8 October 2026; full help content was blocked. Establishes the documented image format, not an exhaustive inventory of formats.
3. [Meta: App Installs carousel specifications on Facebook Search Results][meta-search-carousel]. Official indexed excerpt read on 8 October 2026; documents a carousel format for the placement.
4. [Meta Graph API: Targeting][meta-targeting]. Official indexed reference read on 8 October 2026; lists keyword and contextual-category fields. Full fetch was rate-limited; operational semantics remain unverified.
5. [Meta's official Facebook Marketing API collection][meta-api-examples]. Read on 8 October 2026; includes a targeting keyword field in an ad-set read example, alongside interest-based examples.
6. [Meta: Threads advertising expansion][threads-ads]. Official Portuguese-language announcement from January 2026, read on 8 October 2026; describes personalized delivery and image, video, and carousel formats.
7. [Meta: Threads content controls][threads-controls]. Official Portuguese-language announcement from May 2026, read on 8 October 2026; describes third-party content block lists.
8. [Google Ads: Experiment Center][google-experiments]. Read on 8 October 2026; distinguishes comparative experiments and lift studies.
9. [Google Ads: About Conversion Lift][google-lift]. Read on 8 October 2026; describes treatment/control measurement and account availability limits.

[google-campaigns]: https://support.google.com/google-ads/answer/2567043?hl=en
[meta-search-image]: https://www.facebook.com/business/ads-guide/update/image/facebook-search/traffic
[meta-search-carousel]: https://www.facebook.com/business/ads-guide/update/carousel/facebook-search/app-installs/mobile-app
[meta-targeting]: https://developers.facebook.com/docs/graph-api/reference/targeting/
[meta-api-examples]: https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi?entity=request-31691153-7fe71e07-6a6f-4b86-b098-02788f138d0b
[threads-ads]: https://about.fb.com/br/news/2026/01/anuncios-no-threads-um-ano-depois-agora-alcancando-todos-os-usuarios-e-mercados-globalmente/amp/
[threads-controls]: https://about.fb.com/br/news/2026/05/novo-controle-de-brand-safety-e-suitability-para-anuncios-no-threads/amp/
[google-experiments]: https://support.google.com/google-ads/answer/16856494?hl=en
[google-lift]: https://support.google.com/google-ads/answer/12003020?hl=en-AU
