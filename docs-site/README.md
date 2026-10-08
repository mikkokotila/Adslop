# Documentation scaffold

This directory turns maintained repository Markdown into the production static
documentation site defined by
[`Documentation-System.md`](../docs/Developer/Documentation-System.md).

## Fresh repository

Repository bootstrap fills product name, repository owner, repository name, and
base-path identity. Then:

1. replace starter prose with source-backed product content
2. set `siteUrl` and `basePath` in `product-docs.json`
3. map every maintained source in `docs-map.json`
4. add repository-specific semantic and deployment tests
5. run the locked check before preview or publication

```bash
npm --prefix docs-site ci
npm --prefix docs-site run security:audit
npm --prefix docs-site run check
```

## Existing repository

Copy these surfaces from the template at one pinned commit:

- `.markdownlint.json`
- `docs-site/`
- `docs/Developer/Documentation-System.md`
- one canonical page for each of Overview, Guides, Reference, Developer, and
  Packages

Replace `product-docs.json` and `docs-map.json`; do not fork shared scripts or
CSS for product content. Integrate the three commands above into an existing
required gate. Freeze the current site, build this candidate beside it, and use
the contract's parity protocol before cutover.

## Authored and generated files

Author profile, map, scripts, tests, configuration, and CSS in this directory.
Never author or commit `.generated`, `.docusaurus`, `build`, test results, or
browser reports.
