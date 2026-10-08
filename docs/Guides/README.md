# Documentation site

Build and inspect the documentation scaffold from a repository checkout.

## Prerequisites

- Node.js 20 or later
- npm

## Install and build

```bash
npm --prefix docs-site ci
npm --prefix docs-site run security:audit
npm --prefix docs-site run check
```

The check lints maintained Markdown, verifies external links, assembles every mapped source, builds the static site, checks routes and asset budgets, then exercises desktop, mobile, theme, search, edit-link, and accessibility behavior in Chromium.

## Run locally

```bash
npm --prefix docs-site start
```

Open the URL printed by Docusaurus. Edit `docs-site/product-docs.json` for product identity and `docs-site/docs-map.json` when adding, moving, or removing a maintained page.

## Expected result

The build writes derived output under `docs-site/build`. Generated source and test artifacts remain ignored.

## Failure boundary

An unmapped source, missing mapped source, duplicate route, broken local or external link, Markdown violation, build error, route drift, asset-budget breach, accessibility violation, search failure, or responsive overflow fails the check.

## Read next

Use the [documentation profile reference](../Reference/README.md) before adapting the scaffold.
