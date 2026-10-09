# AGENTS.md

## The only needle: subscription revenue versus advertising spend

Adslop is a **precision instrument for a marketer**, not a developer showcase.
The primary result is **subscription money received (net of refunds and chargebacks) minus
advertising money spent (net of credits)**, measured by product, channel, campaign, keyword,
and creative where the evidence supports it. Report the two monetary inputs,
their difference, and the evidence and time window. Do not replace collected
money with estimated lifetime value, attributed claims, or vanity metrics.

**Every proposed change must identify the marketer's next decision it enables:**
increase subscription receipts, stop wasted ad spend, redirect spend, or make
the money-in/money-out measurement reliable enough to act on. If that connection
is not concrete, do not do the work.

Build the **smallest end-to-end usable increment**. Make its expected behavior
testable, implement it, show the actual result, and stop when it passes.
Safety, provenance, and failure recovery matter when they prevent losing money,
double-counting money, or acting on false evidence. Do not pursue unrelated
infrastructure, abstractions, speculative features, dashboards, reorganizations,
documentation volume, or repeated refinement for their own sake.

Spend neither developer time nor tokens producing work that does not move this
needle. Never fabricate commercial data or claim revenue lift from a unit test.
Distinguish operational correctness, attributed revenue, and experimentally
demonstrated incremental revenue. A phase is complete only when its promised
marketer capability is demonstrated; passing generic tooling alone is not enough.

## Own every pull request through merge readiness

**Opening a PR is not delivery. The contributor owns its closeout, end to end.**
After each push, follow the PR to GitHub's actual merge-ready state on its
latest commit: no conflicts, current with the base, an eligible independent
approval (including code-owner and latest-push review where required), and
**every review conversation explicitly resolved in GitHub**. Editing code or
replying to a reviewer does *not* close the thread. Reply with the fix commit,
resolve the thread, and verify that zero unresolved threads remain.

**All applicable CI jobs must finish and be green on the candidate commit.**
Never call pending, queued, stuck, cancelled, failing, stale, or unexecuted checks
green. Diagnose failures, fix their causes, rerun the checks, and inspect the
final results. If a job is intentionally inapplicable, document its justified
skip rather than claiming it passed. Recheck status and independent approval
after the last push. Do not say "ready to merge" while any required condition
is unmet, and never bypass a gate or manufacture an approval.

**This is the contributor's responsibility, not cleanup delegated to the
marketer.** Resolve what is within the contributor's authority. When an
external account permission, paid entitlement, secret, or human decision blocks
merge, state the exact blocker and the smallest action only the operator can
take, then continue only with authorized work. Do not quietly abandon the PR.

## Repository law and routes

Read **[CLAUDE.md](CLAUDE.md)** first for the binding repository constitution,
then **[PR_GUIDELINE.md](PR_GUIDELINE.md)** and
**[REPO_SPECIFICS.md](REPO_SPECIFICS.md)** for contributor and product rules.

For governance installation or activation, use **[SETUP.md](SETUP.md)**.
For pull-request review, use **[.github/copilot-instructions.md](.github/copilot-instructions.md)**.
