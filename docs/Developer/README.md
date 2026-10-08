# Developer Guidelines

## General Must-Read Developer Documentation

[Adslop Developer Docs](https://github.com/Adslop/dev-docs/blob/main/src/README.md)

## Repository law

The binding rules for this repository — the laws, the workflow, and the code
stance — live in [`CLAUDE.md`](../../CLAUDE.md). That is the single source of
truth; this document only covers what `CLAUDE.md` does not: how the template is
rolled out and extended.

## Prerequisites

- complete [`SETUP.md`](../../SETUP.md) before relying on repository gates
- use Node.js 20 or later for the documentation site
- install documentation dependencies from the committed lockfile with `npm ci`

## Rolling out a new repository from the template

The complete setup runbook — the once-per-organization secrets and variables
(`REPO_BOOTSTRAP_TOKEN`, `RULESET_AUDIT_TOKEN`, `LABEL_TEMPLATE_REPOSITORY`),
the exact token scopes, what the bootstrap does automatically, how to verify it,
the CodeQL-on-private behavior, and every failure mode — is
[`SETUP.md`](../../SETUP.md). Follow it when creating a new repository from this
template.

## Documentation system

[`Documentation-System.md`](Documentation-System.md) is the production
documentation contract. Fresh repositories inherit its starter corpus,
Docusaurus assembly, Adslop theme, local search, locked toolchain, and checks.
Existing repositories can copy the same surfaces and use its side-by-side
parity protocol before cutover.

Product identity and deployment coordinates live in
`docs-site/product-docs.json`; source ownership and public routes live in
`docs-site/docs-map.json`. Do not embed product literals in shared site files.

## Adding an app-specific required gate

A new gate (for example a deployment-contract check) only blocks merges once its
job context is a required status check. Because of the laws, that cannot ride
along in a feature slice:

1. Add the workflow under `.github/workflows/`, with a job `name:` that equals
   the status-check context you want.
2. In a PR of its own (law: ruleset changes are their own PR), add the context
   in three places that must agree: a matching law in [`CLAUDE.md`](../../CLAUDE.md)
   — its trailing `*(context)*` annotation must equal the context exactly — the
   same context in `.github/rulesets/main.json`, and a `gates.<name>` entry in
   [`governance.yml`](../../governance.yml) with `enabled: true`, `required: true`,
   and a matching `context:`. The `pr_checks_honesty` three-way bijection ties
   all three together. Miss any one and the PR fails, naming both sides.
   [`Configuration.md`](Configuration.md) is the canonical description of that file.
3. Apply the matching change to the live ruleset so the `pr_checks_ruleset`
   drift gate stays green.
