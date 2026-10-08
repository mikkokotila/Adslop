# Adslop repository-specific rules

This is the Adslop appendix to [PR_GUIDELINE.md](PR_GUIDELINE.md). Read [CLAUDE.md](CLAUDE.md) first; it remains the canonical constitution.

## Product scope

- `[repo:Adslop]` [SPECIFICATION.md](SPECIFICATION.md) defines the intended product. Distinguish those requirements from implemented and verified behavior in code, documentation, and reports.
- `[repo:Adslop]` Build a generic revenue instrument for digital products. Four Pillars/BaZi is the first example, not a fixed funnel, billing model, or product identity.
- `[repo:Adslop]` The first accepted product release coordinates campaign creation on Google and Meta, conversion tracking, performance measurement, deterministic PnL-based allocation across platforms and creative-serving units, keyword pruning, and campaign reconciliation. Preserve each platform's actual targeting and creative semantics.
- `[repo:Adslop]` Keywords constrain eligibility against search or text context. Do not silently substitute interest audiences or treat an audience-category search as keyword targeting. Meta conformance remains the specific external dependency recorded in the specification.
- `[repo:Adslop]` Every substantive human workflow must be available through the supported API with the same validation, evidence, and authority checks for agents.
- `[repo:Adslop]` Establish dependable execution and measurement before expanding into autonomous campaign strategy, landing-page changes, or application development.

## Evidence and execution

- `[repo:Adslop]` Preserve event-sourced state and full accessible provenance. Requested, attempted, acknowledged, and independently observed external actions are different facts.
- `[repo:Adslop]` Replay reconstructs state or analysis without repeating external writes, conversion uploads, or spend. New side effects require a new authorized execution context.
- `[repo:Adslop]` Experiments have versioned manifests before exposure, and results remain linked to their design and evidence. Keep attributed performance separate from properly supported incremental effects. Allocation and pruning remain within a declared adaptive policy; fixed comparisons are protected.
- `[repo:Adslop]` Reconcile configuration, execution, spend, outcomes, and financial records before consequential allocation. Do not turn unknown data into zero, double-count reservations and accrued cost, or release capacity on an unconfirmed budget reduction.
- `[repo:Adslop]` Releases and analyses must identify their exact versions and inputs. Record unavailable evidence or reproduction limits rather than inventing observations.
- `[repo:Adslop]` Credentials, advertising-account tokens, personal customer records, and operational secrets must remain outside source control and ordinary audit payloads.

## Repository operation

- `[repo:Adslop]` On Mikko's Mac, use `/Users/mikkokotila/dev/Adslop`. Keep the checkout, environments, and generated work out of iCloud-backed directories.
- `[repo:Adslop]` This repository is private. Public visibility, public documentation hosting, and package publication require an explicit release decision; installing governance does not authorize them.
- `[repo:Adslop]` Follow the slice contract, version and changelog requirements, required checks, and independent review rules in the constitution. No gate failure is waived because only one maintainer currently has access.
- `[repo:Adslop]` [SETUP.md](SETUP.md) records governance activation requirements and observed blockers. Checked-in rules are not proof that GitHub is enforcing them.
- `[repo:Adslop]` [MAINTAINERS.md](MAINTAINERS.md) identifies the authorized maintainer. An additional reviewer or code owner requires that maintainer's authorization; do not import unrelated reviewer accounts.
