# CLAUDE.md

The repository law, operating discipline, and code stance — the single canonical constitution for every contributor, human or agent.

> **Installing or activating Adslop governance?** Read [SETUP.md](SETUP.md) first. It records the required credentials, platform capability, review eligibility, and observed activation blockers. Checked-in rules are not evidence that GitHub is enforcing them.

The tagged contributor rules are in [PR_GUIDELINE.md](PR_GUIDELINE.md), and Adslop-specific scope is in [REPO_SPECIFICS.md](REPO_SPECIFICS.md). [SPECIFICATION.md](SPECIFICATION.md) defines product intent; implementation evidence establishes current behavior.

## Motivation

We don't want saga ornamentation. We want commits that move the needle. The needle is the thing that humans actually benefit from in the software. Always ask "what are the key usage paths here, and how is this proposed change moving those?". Never be satisfied with work that seems to check the boxes, but doesn't really move the capability where the actual benefit is.

## The laws

Ten laws. Nine are workflow gates on every PR; the tenth is branch protection on `main`. Any failure blocks merge. No bypass.

1. **Every PR closes exactly one OPEN slice-labelled issue — plus that slice's parent PRD when, and only when, the slice is the PRD's last open sub-issue.** PR title byte-equals the slice issue's title. Diff stays within the issue's `## Surfaces` globs. Diff touches no path in `## Out of Scope`. Issue body preserves every `> **Significance.**` blockquote from the slice template verbatim, and every `Done Means` checkbox is checked or carries `OVERRULED: <reason>` before merge; the `slice_closeout_guard` workflow writes the closeout evidence fields when a merged PR closes the issue and reopens an evidence-less close. A PR opened by an author in `automation.bot_authors` skips this law while `automation.exempt_gates` lists `slice` — dependency bumps carry no slice issue, and the remaining applicable laws still run on them. *(pr_checks_slice)*

2. **PR title, every non-merge commit, and the linked issue title match Conventional Commits v1.0.0, and no commit message or the PR title names an AI/LLM assistant.** Allowed types: `feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert`. *(pr_checks_cc)*

3. **Typing discipline never weakens.** No new `Any`, `cast(..., Any)`, `# type: ignore`, `# pyright: ignore`, or `# noqa`. Pyright error count cannot rise. The `typing` budget in `.github/budgets.json` cannot be raised, and the scan surface in `governance.yml` cannot be narrowed, by the PR it gates. *(pr_checks_typing)*

4. **Silent-fallback patterns never grow.** No new bare `except:`, empty handler (`pass`, `...`, `return`, `return None`, `continue`, `break`), `contextlib.suppress` (or any alias chain thereof), or `errors='ignore'`. The `fail_loud` budget in `.github/budgets.json` cannot be raised, and the scan surface in `governance.yml` cannot be narrowed, by the PR it gates. *(pr_checks_fail_loud)*

5. **Every PR records a valid release version and leaves a CHANGELOG trail.** An existing `[project].version` advances strictly forward by canonical numeric `MAJOR.MINOR.PATCH`. `CHANGELOG.md`'s first `# v<X.Y.Z>` header equals the new version and carries at least one content line beyond headings, written imperatively ("Add", not "Added") and free of leftover placeholders. Bump level meets the Conventional Commits type minimum: `type!` → major, `feat` → minor, else patch. Initial-version mode applies only when both `pyproject.toml` and `CHANGELOG.md` are absent on the Git-verified ancestor PR base and the PR adds both; the first version and matching content receive the same validation, without inventing a prior version. A partial baseline or missing head artifact fails. A PR opened by an author in `automation.bot_authors` skips this law while `automation.exempt_gates` lists `version` — a dependency bump is not a release of this project. *(pr_checks_version)*

6. **The lint gate passes.** Ruff, at the version `pyproject.toml` pins, across the package, `governance/`, and `tests/`; no dead code (vulture); every package module and every `governance/` module within its declared line budget in `.github/budgets.json` (file-size balance applies to the package tree, where a ratio is meaningful; the gate modules are held by their individual budgets instead), and every module carrying a docstring except where `governance.yml` exempts it; the docstring conventions, file-size balance (against the bound that file declares), and test/code ratio all hold; no test outside the paths `governance.yml` names as infrastructure uses `try`/`except`, and no honesty-violation is swallowed; changed lines arrive covered; declared runtime dependencies carry no known vulnerability (pip-audit, with time-boxed `.github/vuln_exceptions.json` entries); the documentation corpus passes its locked audit, lint, link, build, route, asset, browser, and accessibility checks; and the coverage floor in `.github/budgets.json` holds and ratchets upward — it cannot be lowered by the PR it gates without a `[coverage-lower: <field>: <reason>]` marker. *(pr_checks_lint)*

7. **`pytest tests/package -q --maxfail=1` passes, inside its recorded runtime ceiling.** The suite completes within `runtime.max_total_seconds` in `.github/budgets.json`, and that ceiling cannot be raised by the PR it gates without a `[runtime-raise: <reason>]` marker in the PR body. Lowering it needs no marker. *(pr_checks_tests)*


8. **The configuration, the written laws, and the enforced gates agree exactly.** The gates `governance.yml` marks enabled and required, the workflow-gate laws here, and the required status checks on `main` are in three-way bijection — every required check has a law, and every gated law is required. A gate added to the ruleset without a law, or a law whose gate was dropped, fails this gate. *(pr_checks_honesty)*

9. **Live branch protection on `main` matches `.github/rulesets/main.json`.** Changing branch protection out-of-band (in the GitHub UI) blocks the next PR until the snapshot is updated in a PR of its own. *(pr_checks_ruleset)*

10. **No direct push to `main`. No force-push. No branch deletion.** Branch must be up-to-date with `main` before merge. Require one eligible independent human approval, code-owner review on enforcement surfaces, independent approval of the latest push, and resolution of every review thread. The ruleset may request advisory Copilot review, but it is not a required CI check. **Never wait for Copilot** when its quota is exhausted: do not request, retry, or block an otherwise eligible merge; independent human approval and all required CI gates remain mandatory. A failed advisory bot check must never be presented as green. No bypass actors. *(branch protection, server-side)*

Beyond the gates, `audit_main_ruleset` re-checks the live ruleset on every push to `main` with a privileged token — including `bypass_actors`, which the PR-time ruleset gate (`pr_checks_ruleset`) cannot observe. It is a post-merge alarm, not a merge gate, so it carries no law of its own.

## Workflow

Branch off `main`. Commit the first working increment and push to a remote branch of the same name, then **open the PR right away — before you run the gates locally, and never as a draft.** Opening it first starts CI immediately; run the local gate suite afterwards, keep working while GitHub runs the gates too, and don't wait for CI in the foreground. Never sit on local verification without an open PR; open a real PR or none.

**Mikko Kotila (`mikkokotila`) is the project authority and operator.** He decides scope, appointments, and release authorization. Request an authorized, eligible independent reviewer when the PR opens and again after requested changes are addressed. Read your own full diff before requesting that review.

Mikko remains the maintainer and has appointed `bit-mis` as an independent reviewer and code owner. A PR authored or last pushed by Mikko's account cannot obtain the required independent approval from the same account. The appointed reviewer must accept write access before GitHub can count the required review. Missing reviewer access remains an explicit blocker; do not invite an unrelated account or bypass the policy. See [MAINTAINERS.md](MAINTAINERS.md). The project-authority setting does not make GitHub enforce a single reviewer identity when the ruleset's `required_reviewers` list is empty.

Each push re-runs every gate. Prefer new commits to amends — amends don't give you anything and they muddle the PR history. Keep one logical change per commit; don't batch unrelated changes together. Before you request review, read your own full diff in GitHub — catch what you'd flag in someone else's PR.

Merge requires every applicable gate to be green on the exact candidate, a branch up-to-date with `main`, eligible independent reviews, and resolved threads. Rebase when main advances. Claim server-side protection only after the live activation checks in [SETUP.md](SETUP.md) succeed; unavailable enforcement is a blocker, not a waiver.

When a gate fails, the gate's own output names the reason. Read the output, fix the code or the slice issue, push again. If the failure is the gate being wrong rather than the PR being wrong, fix the gate in its own PR — the ruleset drift gate (`pr_checks_ruleset`) will force the matching ruleset-snapshot update so no gate relaxation side-enters.

## Review work

**Reviewing a pull request?** The canonical brief is [`.github/copilot-instructions.md`](.github/copilot-instructions.md) — how to read a diff beyond its own lines, what to hunt, the verdict ladder, and how to post. Work entirely from it; it is also what GitHub's built-in Copilot review reads, so every reviewer (Copilot, agent, or human) holds one shared standard.

The same posture governs the rest of review work. When reviewing an issue, post comments directly in the thread. When addressing comments on your own issue or PR, handle every one — blocking or not — with either a commit (and name that commit in the thread) or a reply explaining the resolution, or why it is not addressed; then resolve the thread. Merge stays blocked until every thread is resolved (`required_review_thread_resolution`, server-side). The opinion is the deliverable; never confirm with the operator before posting — it only adds a round-trip.

## Beyond the laws

The gates check shape, scope, format, ratchets, and named test suites. They do not check whether the slice's capability actually works. The operator judges that at review time, against the following stance:

**Radical simplicity.** The simplest code that meets the requirement wins. Complexity earns its place by naming the specific concern it addresses — not "robustness" or "future-proofing" in general.

**No defensive fog; fail loud.** Agents are primed to produce defensible-looking code: `try/except` that swallows, fallbacks for cases that don't happen, docstrings that restate the signature, comments that narrate the line, parameters that might be useful someday. None of it belongs. When something is wrong, find the root cause and fail loudly and early — never paper over missing state with a workaround, a fallback, or a swallowed error. The fail-loud gate (`pr_checks_fail_loud`) catches the AST-detectable forms; the rest is operator-caught at review.

**No sitting in the dark.** Never suppress callable output, script output, or sub-agent logs to save context — stay fully aware of what the running process is doing.

**No long-running commands.** Do not repeatedly run long-running commands. If something needs to be run repeatedly, immediately profile it, and report back to operator the profile results. The operator is expert in performance hacking, you are not. 

**Minimal scope.** Touch only the files the task demands. Drive-by cleanups go in a separate slice.

**No synthetic data.** Ever. Inventing data is not a shortcut — it corrupts everything downstream. If the real data isn't there, stop and ask.

**Validate against the stated expectation.** The question is never "did it run" — it's "did it return what the slice promised."

**Deliver meaning not mechanics.** It's better to deliver the right meaning poorly, than deliver meaningless scaffolding and mechanics in an impressive way. 

**The smallest possible honest way always.** Slice spec, code, communication, everything, let it be the smallest possible unit size that honestly delivers what is required.

## Conventions

Concrete house style the gates don't check — not judgment calls, just the defaults to follow:

- **Dependencies.** Prefer the standard library or an existing project dependency. A new external dependency must be required by the task, not a convenience.
- **Logging.** Use `logging.getLogger(__name__)` in library code. (`print` in the package is already gate-blocked.)
- **Public surface.** Expose the public API explicitly with `__all__`; prefix internal names with `_`.
- **Resources.** Use context managers for anything that must close; avoid mutable default arguments; prefer `pathlib` over `os.path`.
- **LLM output.** A model may draft, but raw model output is never dropped in as-is — the contributor simplifies it, understands it, and owns it.
- **Docs.** Author each thing once: one page is canonical, the rest link to it. Show real, runnable examples and current behavior. Product requirements may describe intended behavior when explicitly labelled, as in `SPECIFICATION.md`; do not present that intent as implemented capability.
- **Release notes.** Technically correct, concise in summary, specific in detail, and tied to the pushed tag.

## When in doubt, stop

This is collaboration. If the requirement is unclear, if the scope is ambiguous, if a gate's meaning is unobvious, if the fix would require touching something that wasn't asked for — stop and ask the operator. Proceeding through doubt is where harm accumulates.

## Task-concluding messages

If a commit was made, show the hash.
If a review was left, share the link. 
If a PR was made, share the link.
