# Adslop documentation

Adslop is being developed to manage revenue campaigns for digital products.
The repository currently contains the product specification, a Python package
baseline, and the development and documentation tooling. It does not yet
create campaigns, collect conversions, or operate a revenue optimization loop.

## Start by task

- Read the [product specification](../SPECIFICATION.md) for planned behavior
  and acceptance requirements, including the unresolved Meta capability.
- Read [revenue engine research](Reference/Revenue-Engine-Research.md) for Meta findings,
  deterministic control, and the proposed collection and implementation stack.
- Use [Guides](Guides/README.md) to build and preview these documents locally.
- Use [Reference](Reference/README.md) for the documentation configuration.
- Use [Developer](Developer/README.md) for contribution and verification.
- Use [Packages](../adslop/README.md) for the current Python package boundary.

## Current workflow

Start with the root [README](../README.md) and the specification. Follow the
local documentation guide to render the maintained sources, then inspect the
result in a browser. That rendered documentation is the current observable
output; an advertising workflow is not yet implemented.

The specification describes intended product behavior, not a callable API or
evidence that platform integrations work. Product examples and API references
will be added with their implementations.

## Access and publication

The repository is private. Open-source development is intended, but the docs
have no production hosting configuration. The configured site origin is a
local preview address. Current repository enforcement prerequisites and
blockers are recorded in [SETUP.md](../SETUP.md).

## Read next

Build the [documentation site](Guides/README.md), or read the
[development workflow](Developer/README.md).
