# Developing Adslop

This section documents the current development tooling. The product behavior
in [SPECIFICATION.md](../../SPECIFICATION.md) remains planned until implemented
and verified. The package currently provides no campaign API.

## Authority and prerequisites

Read [CLAUDE.md](../../CLAUDE.md) for repository law and the contribution
workflow. Read [SETUP.md](../../SETUP.md) before relying on live enforcement.
The current GitHub plan blocks activation of the intended repository ruleset;
checked-in policy is not proof that server-side protection is active.

Use the Python version and hash-locked dependencies declared by
`governance.yml`, `pyproject.toml`, and `requirements/ci/`. Documentation uses
Node.js 20 or later and the committed npm lockfile.

## Working on a change

1. Define the change's slice and permitted surfaces under the repository law.
2. Work on a branch, make the first working increment, and open a non-draft
   pull request before running gates locally.
3. Run the relevant checks, inspect their actual results, and fix failures.
4. Obtain the required review and resolve all threads before merge. Do not
   treat unavailable live enforcement as permission to bypass the policy.

API implementation, adapters, conversion collection, and experiment execution
are future product work. Governance and documentation checks prove their own
contracts; they do not prove that the future product exists.

## Documentation

[Documentation-System.md](Documentation-System.md) defines the five-section
structure, local assembly, typography, route verification, accessibility, and
browser checks. The [build guide](../Guides/README.md) gives the current commands.
Product identity is in `docs-site/product-docs.json`; maintained sources and
routes are in `docs-site/docs-map.json`. Hosting remains unconfigured.

## Changing a required gate

A gate change must preserve agreement among the law in `CLAUDE.md`, its entry
in `governance.yml`, the workflow context, and `.github/rulesets/main.json`.
[Configuration.md](Configuration.md) describes those relationships. A matching
live ruleset update and its verification are also required before claiming
server-side enforcement. Preserve a visible blocked state when GitHub access
or plan limitations prevent that step.

## Read next

- [Configuration](Configuration.md)
- [Packaging](Packaging.md)
- [Security assurance and current limits](Security-Assurance-Case.md)
- [Release policy](Release-Policy.md)
