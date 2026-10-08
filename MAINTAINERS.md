# Maintainers

The current authorized maintainer and project authority is **Mikko Kotila (`@mikkokotila`)**.

The maintainer owns product decisions, release approval, security advisory triage, issue prioritization, and reviewer appointments. The same identity is declared in `governance.yml` and on the enforcement surfaces in `.github/CODEOWNERS`.

## Independent review

The declared ruleset requires one eligible approving review, code-owner approval for enforcement changes, and independent approval of the latest push. A PR author cannot approve their own PR, and the most recent pusher cannot supply the required last-push approval.

Only Mikko currently has authorized maintainer access. A PR authored and pushed through his account therefore cannot satisfy these independent-review requirements with his own review. An additional reviewer must be explicitly authorized and have write access. For enforcement changes, an eligible non-author code owner must also be established through the governed ownership process.

The `review.approving_authority` setting identifies project authority; it does not make an empty GitHub `required_reviewers` list restrict all eligible approvals to that identity. Copilot review is separate from the required independent human approval.

See [SETUP.md](SETUP.md) for the current activation state. Missing review eligibility is a blocker, not an administrative bypass.
