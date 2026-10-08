# Build and preview the documentation

Build the maintained Adslop documentation from a checkout. This guide does not
launch the advertising system; that system is still specified rather than
implemented.

## Prerequisites

- Node.js 20 or later and npm
- access to this private checkout
- a non-draft pull request opened before running gates for a change, as
  required by [CLAUDE.md](../../CLAUDE.md)
- `GITHUB_TOKEN` in the environment when mapped pages contain absolute links
  to this private repository; the token needs read access to those resources

Do not place tokens in the documentation profile or commit them. CI supplies
its repository token to the documentation-check step. Public external links
are checked without authentication.

## Install and verify

Run from the repository root after the pull request is open:

```bash
npm --prefix docs-site ci
npm --prefix docs-site exec -- playwright install chromium
npm --prefix docs-site run security:audit
npm --prefix docs-site run check
```

The check lints maintained Markdown, runs the documentation unit tests,
verifies external links, assembles mapped sources, builds the site, checks
routes and asset budgets, then exercises desktop, mobile, themes, search,
edit links, and accessibility in Chromium.

## Preview the built result

```bash
npm --prefix docs-site run serve
```

Open `http://127.0.0.1:3100/`. For live editing, run
`npm --prefix docs-site start` and use the development URL it prints.

## Expected result

The static build is written to `docs-site/build`. The product specification
appears under Overview and describes planned behavior. Generated files and
browser artifacts remain ignored. Building or serving locally does not
publish the site or change repository visibility.

## Failure boundary

A missing source, duplicate route, broken link, Markdown violation, build
error, route drift, asset-budget breach, accessibility violation, search
failure, or responsive overflow fails the check. A missing token, inaccessible
private resource, unknown authenticated URL shape, or genuine 404 is not a
successful private-link check.

## Read next

Use the [documentation profile reference](../Reference/README.md) when adding
sources or changing preview coordinates.
