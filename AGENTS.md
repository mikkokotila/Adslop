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

## Repository law and routes

Read **[CLAUDE.md](CLAUDE.md)** first for the binding repository constitution,
then **[PR_GUIDELINE.md](PR_GUIDELINE.md)** and
**[REPO_SPECIFICS.md](REPO_SPECIFICS.md)** for contributor and product rules.

For governance installation or activation, use **[SETUP.md](SETUP.md)**.
For pull-request review, use **[.github/copilot-instructions.md](.github/copilot-instructions.md)**.
