# Maintainers

The current authorized maintainer and project authority is **Mikko Kotila (`@mikkokotila`)**.

The maintainer owns product decisions, release approval, security advisory triage, issue prioritization, and reviewer appointments. The same identity is declared in `governance.yml` and on the enforcement surfaces in `.github/CODEOWNERS`.

## Independent review

The declared ruleset requires one eligible approving review, code-owner approval for enforcement changes, and independent approval of the latest push. A PR author cannot approve their own PR, and the most recent pusher cannot supply the required last-push approval.

Mikko has appointed **`@bit-mis`** as an independent reviewer and code owner on the enforcement surfaces. The exact GitHub account was verified as user ID `265471408`, and repository write access was invited on 8 October 2026. Invitation acceptance remains pending at this recorded checkpoint. This appointment does not transfer project or release authority.

A PR authored and pushed through Mikko's account cannot satisfy the independent-review requirements with his own review. `bit-mis` must accept repository write access before their review can count; the applicable ownership declaration must also be present on the PR's base branch for automatic code-owner review. During initial adoption, obtain and verify the appointed owner's independent review explicitly. Future reviewer appointments require the maintainer's authorization.

The `review.approving_authority` setting identifies project authority; it does not make an empty GitHub `required_reviewers` list restrict all eligible approvals to that identity. Copilot review is separate from the required independent human approval.

See [SETUP.md](SETUP.md) for the current activation state. Missing review eligibility is a blocker, not an administrative bypass.
