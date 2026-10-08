# Documentation tooling

This directory renders the maintained Markdown sources listed in
`docs-map.json`. The [documentation system contract](../docs/Developer/Documentation-System.md)
defines its five-section structure and verification requirements.

The current profile serves a local preview at `http://127.0.0.1:3100/`.
No production documentation host has been selected. The private repository's
[specification](../SPECIFICATION.md) is mapped as planned behavior, not a
reference for an implemented API.

Follow the [build and preview guide](../docs/Guides/README.md) for installation,
Chromium setup, verification, token handling for private repository links, and
local serving. Open the change's non-draft pull request before running gates.

## Source boundaries

- `product-docs.json`: identity and preview/deployment coordinates.
- `docs-map.json`: maintained sources and stable routes.
- `scripts/`: assembly, validation, link checks, and dependency audits.
- `tests/`: unit and rendered-browser contracts.
- `src/css/custom.css`: typography, color, layout, and responsive behavior.

Keep product claims in maintained source pages. Never author or commit
`.generated`, `.docusaurus`, `build`, browser traces, or test reports.
