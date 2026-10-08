# Adslop governance setup

This runbook applies to the existing private repository `mikkokotila/Adslop`. The working checkout on Mikko's Mac is `/Users/mikkokotila/dev/Adslop`; keep it and its environments outside iCloud-backed directories. Do not create a replacement repository or overwrite the product specification to activate governance.

Read [CLAUDE.md](CLAUDE.md) for policy and [governance.yml](governance.yml) for the configured gates. Installing their files and activating their GitHub enforcement are separate steps.

## Activation state recorded during adoption

The adoption inspection on 8 October 2026 established the following state. Recheck it when activating governance and record the resulting workflow run and ruleset identity.

| Requirement | Observed state | Effect |
| --- | --- | --- |
| Private-repository rulesets | GitHub returned HTTP 403 for the current plan | Protected-main enforcement cannot be claimed active |
| `REPO_BOOTSTRAP_TOKEN` | Missing | The privileged activation workflow cannot administer repository settings |
| `RULESET_AUDIT_TOKEN` | Missing | The post-merge audit cannot independently inspect the complete live ruleset |
| Independent reviewer | Only `mikkokotila` has authorized maintainer access | His own PR and latest push cannot be approved by the same account |
| Copilot code review | Availability unverified | The declared automated-review requirement has not been demonstrated |
| CodeQL | Unsupported in the current private configuration | Its workflow, law, configured gate, and required context are removed together |

These are activation blockers, not exceptions to the policy. The repository remains private. Do not turn a failed capability check into a successful-looking skip or add an administrative bypass to claim completion.

## 1. Establish GitHub capability and independent review

Confirm that GitHub Actions runs for this repository and that the account's private-repository plan supports the declared ruleset. Recheck access without changing visibility:

```bash
gh api repos/mikkokotila/Adslop/rulesets
gh run list --repo mikkokotila/Adslop
```

An HTTP 403 must be resolved through the appropriate account capability or permission before ruleset activation. Confirm Copilot code review is available and can perform the automatic review declared in the snapshot.

Mikko Kotila (`mikkokotila`) is the project authority in `governance.yml`. He must authorize any additional reviewer and their write access. Do not copy unrelated reviewer accounts or send invitations merely to fill a template field.

The declared ruleset requires one eligible independent approval and approval of the latest push by someone other than its pusher. A PR author cannot approve their own PR. Enforcement-file changes also require a non-author code owner's approval. An additional owner must be appointed and recorded through the governed ownership process. Copilot review does not replace the human approval. A configured project-authority name does not make GitHub enforce that single identity when its `required_reviewers` list is empty.

## 2. Configure the two repository secrets

Use the secret names declared in `governance.yml`. Enter credentials through GitHub's secret interface or the CLI's secure prompt; never put a token in source, a PR, a command argument, or an audit record.

### `REPO_BOOTSTRAP_TOKEN`

The explicit activation workflow uses this credential to reconcile the committed label manifest, apply the protected-main ruleset, and record `RULESET_ID`. Use a Personal Access Token or suitable GitHub App token with access to `mikkokotila/Adslop`, owned by an authorized repository administrator. The built-in `GITHUB_TOKEN` cannot administer repository rulesets.

The runtime needs Issues write for labels, Administration write for rulesets, Variables write for `RULESET_ID`, and Metadata read. The workflow's checkout uses the built-in token with Contents read. Bootstrap does not create branches, issues, pull requests, or workflow changes, so its administration token does not need those additional write permissions. For a classic PAT, `repo` is the broader corresponding scope; a fine-grained credential permits the narrower repository-specific access. No external label-source access is required.

```bash
gh secret set REPO_BOOTSTRAP_TOKEN --repo mikkokotila/Adslop
```

### `RULESET_AUDIT_TOKEN`

Keep this credential separate and read-only. The post-merge audit needs Administration read and Metadata read so it can observe the full live ruleset, including `bypass_actors`. A classic PAT uses the documented `repo` scope; a fine-grained credential permits the narrower read-only access.

```bash
gh secret set RULESET_AUDIT_TOKEN --repo mikkokotila/Adslop
```

Verify the secret names are configured without printing their values:

```bash
gh secret list --repo mikkokotila/Adslop
```

## 3. Apply the adopted configuration explicitly

The adoption PR establishes the specialized package, documentation, and governance files. Once that change has passed its applicable checks and been merged through the authorized review process, invoke the maintenance workflow explicitly:

```bash
gh workflow run bootstrap_repository.yml --repo mikkokotila/Adslop --ref main
```

`bootstrap_repository.yml` is invoked through `workflow_dispatch` on `main` and checks out `main` explicitly. It runs only the GitHub configuration operation against the committed manifest and ruleset. It does not rewrite files, create a maintenance PR, or merge changes. Ordinary pushes to `main` do not run bootstrap.

Any file changes, including package identity or CodeQL changes, belong in a separate scoped slice and PR with the normal version, check, and review requirements. The local `--files-only` bootstrap command produces reviewable file changes; repeating it on an already adopted repository preserves its README, specification, version, and calibrated budgets.

Label definitions live in `.github/labels.json`. The label operation creates or updates those definitions without deleting unrelated labels or their issue associations. No external label-source variable is required. The separate `copy-standard-labels.yml` maintenance workflow applies the same local definitions when labels need reconciliation.

Activation applies the `Protect-Main` snapshot from `.github/rulesets/main.json` and stores the returned identity in the `RULESET_ID` repository variable. Do not invent that identity or report a ruleset-file diff as evidence that the live configuration changed.

## 4. Verify repository and live behavior

Inspect the activation result, variable, live rules, and labels:

```bash
gh run list --repo mikkokotila/Adslop --workflow bootstrap_repository.yml
gh variable list --repo mikkokotila/Adslop
gh api repos/mikkokotila/Adslop/rulesets
gh api repos/mikkokotila/Adslop/rules/branches/main
gh label list --repo mikkokotila/Adslop
```

The successful activation must identify the real `Protect-Main` ruleset and set `RULESET_ID`. Its required status contexts must agree exactly with the enabled-and-required gates in `governance.yml` and the laws in `CLAUDE.md`. The snapshot requires no bypass actors, current branches, independent review, code-owner review on enforcement surfaces, resolved threads, and automatic Copilot review.

Run and inspect the privileged audit after its prerequisites are configured:

```bash
gh workflow run audit_main_ruleset.yml --repo mikkokotila/Adslop --ref main
gh run list --repo mikkokotila/Adslop --workflow audit_main_ruleset.yml
```

A run skipped because `RULESET_ID` is absent is not proof that branch protection passed. A failing or unexecuted privileged audit does not establish that bypass actors were checked.

On the governed PR, verify the required contexts appear on the exact head and that `pr_checks_honesty` passes. The declaration check, live-ruleset check, independent review, and actual GitHub merge decision must all agree before protected merge readiness is claimed. The merge-readiness reporter and packaging/install checks are advisory; do not add them to the required inventory without a matching law and configuration change.

For local verification, follow [CONTRIBUTING.md](CONTRIBUTING.md). The documentation proof includes:

```bash
npm --prefix docs-site ci
npm --prefix docs-site exec -- playwright install chromium
npm --prefix docs-site run security:audit
npm --prefix docs-site run check
```

A documentation build is local verification. Public hosting and PyPI publication remain disabled until separately authorized and configured. `PYPI_PUBLISH_ENABLED` must remain unset or false for this adoption.

## 5. Restore CodeQL when supported

Track CodeQL restoration as a separate governed change. Once the private repository has the necessary capability, restore `pr_checks_codeql.yml`, the configured CodeQL gate, its constitution law, the `PR Checks CodeQL (python)` required context, and the corresponding snapshot fixtures together. Revalidate the three-way agreement and update the live ruleset through the authorized administration path.

Do not make the repository public as an implicit remedy for unavailable private-repository features.

## Failure handling

| Failure | Required response |
| --- | --- |
| Ruleset API returns HTTP 403 | Resolve plan capability or administrator permission; leave activation explicitly blocked |
| `REPO_BOOTSTRAP_TOKEN` is missing | Configure the authorized repository secret, then rerun explicit activation |
| `RULESET_ID` is absent after activation | Inspect ruleset-creation and variable-write errors; verify the actual returned ruleset identity |
| The privileged audit cannot read `bypass_actors` | Correct the audit credential's Administration read access |
| A required human or code-owner review is unavailable | Obtain an authorized eligible reviewer; do not self-approve or bypass the requirement |
| Copilot review does not run | Resolve account/repository availability and the automatic-review configuration |
| A label definition is invalid | Correct the checked-in label contract; do not delete live labels to mask the failure |


## Activation tracking

Live protection and reviewer prerequisites are tracked in [issue #3](https://github.com/mikkokotila/Adslop/issues/3). The documented CodeQL fallback is tracked in [issue #4](https://github.com/mikkokotila/Adslop/issues/4). These issues remain open until their activation evidence exists.
