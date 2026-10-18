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

## Batch necessary human input into one prepared handoff

Complete every authorized action that can proceed without the operator first.
Before asking, establish that the missing fact, decision or mandatory human action
actually blocks the remaining work and cannot reasonably wait until the final batch.

- Use one isolated browser window, with prepared tabs ordered left to right in the
  same sequence as one comprehensive decision form. Keep unrelated tabs untouched.
- Put every currently necessary input and approval in that form. For each item,
  explain the decision, why the operator is needed, the exact account/entity,
  consequences, and what the agent will complete afterwards. Prefill established
  facts; provide direct links and exact steps only for actions the human must do.
- Preserve entered answers and existing authorization. Do not ask the operator to
  repeat facts, navigate between scattered requests, or relay tokens between pages.
  Handle authorized credential transfers securely without exposing secrets in the
  form, chat, source control or ordinary audit records.
- Distinguish current human blockers, provider dependencies and future conditional
  decisions. Do not present agent engineering work as an operator task or imply
  approval of spending, subscriptions, access or launch that was not given.
- Make a new request only when a genuinely new blocker cannot join the final batch;
  explain the specific reason. Respect mandatory human-only actions and confirmation
  rules; batching never substitutes for required consent.

This keeps the marketer's intervention focused on decisions needed to establish
reliable subscription receipts versus advertising spend.

## Own every pull request until **every** merge gate is green

**Every PR is the agent's responsibility through actual GitHub merge readiness.
No exceptions, no handoff of routine PR monitoring to the marketer.**

- **Push and open the PR immediately.** As soon as a coherent, reviewable working
  increment exists, commit, push, and open a **non-draft** PR. Never hold a push
  or PR for local tests, formatting, builds, or other local preparation. Remote
  review and CI take priority; run local checks in parallel after the PR exists.
  On each change, push promptly so the remote reflects the current candidate.
- **Monitor one active PR every five minutes, without stopping while working.**
  Inspect current GitHub CI runs, review decisions and inline comments,
  unresolved review threads, merge conflicts, branch currency, and mergeability.
  Every failure receives a technical fix, new push, and repeat verification.
  Every review comment receives a concrete fix or substantive answer, followed
  by an explicit **Resolve conversation** action. Verify that zero review
  threads remain unresolved; a reply or code fix alone never counts.
- **When working across multiple PRs, check every open PR at least once every
  ten minutes**, and check an actively edited PR every five minutes. While one
  PR is waiting for local tests, remote CI, or review, work on the next
  independently useful PR. No idle waiting and no forgotten PRs.
- **All checks, not some checks.** The candidate is not complete until **every
  required and applicable CI workflow and job** has finished successfully on
  the latest commit: no failures, errors, queued jobs, pending runs, unfinished
  jobs, stuck executions, or cancellations presented as green. Inspect all
  configured status contexts, not a selected subset. Diagnose and resolve
  actual failures; rerun after fixes. Do not relabel a red check as acceptable,
  mark a slice green while a dependency fails, or bypass/disable any gate.
- **Require the actual green merge button**: the branch is current with its
  base, conflicts are absent, the latest commit has eligible independent
  approval, code-owner and last-push review requirements are met, every
  conversation is resolved, and GitHub confirms the PR is mergeable. Check
  again after the last push and before claiming merge readiness.
- **External blockers must be named precisely and acted on immediately within
  available authority.** Activate configured enforcement when authorized;
  if an external entitlement, account secret, or independent human action
  is truly necessary, identify that exact requirement. A blocked PR stays
  **blocked**, never 'done' or 'almost green'. Keep doing other useful work
  while actively checking the open PRs.

**Never wait for Copilot.** The built-in reviewer consistently reports a
quota-exhausted failure and is **advisory**, not one of the required nine CI
checks. Do not manually request, retry, monitor, or wait for its review;
continue immediately with \`bit-mis\` or another authorized independent human
reviewer. Do not call its failed bot check green. Every required CI gate,
independent human approval, branch currency, and zero unresolved review threads
remain mandatory; if an automated review ever becomes a truly required status,
report the conflict and enforce the actual configured gate instead of bypassing
it.

These checks are obligations **during active work**. No contributor may claim
unattended monitoring after the session ends unless a real monitoring service
has been separately established and verified.

## Repository law and routes

Read **[CLAUDE.md](CLAUDE.md)** first for the binding repository constitution,
then **[PR_GUIDELINE.md](PR_GUIDELINE.md)** and
**[REPO_SPECIFICS.md](REPO_SPECIFICS.md)** for contributor and product rules.

For governance installation or activation, use **[SETUP.md](SETUP.md)**.
For pull-request review, use **[.github/copilot-instructions.md](.github/copilot-instructions.md)**.
