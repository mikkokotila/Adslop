# Technical debt

Known technical debt in shipped code. This page is for debt that is
**accepted and intentionally carried** — not a task backlog. Unstarted work
belongs in an issue; the distinction this page exists to preserve is between
"we decided to live with this" and "nobody has got to it yet".

## Prerequisites

- the current implementation, tests, and issue history for the affected surface
- evidence that the limitation is still present and still matters

## Register rules

Each entry carries:

- a stable debt id
- the affected module or public surface
- the origin PR or evidence source
- current severity
- realistic blast radius
- the trigger condition for fixing it
- the migration or removal path
- the docs that must change when it is fixed

Severity describes current risk in this repository, not hypothetical
downstream risk alone. If a downstream assumption raises severity, state that
condition explicitly rather than inflating the rating.

## Closure rules

When an item is fixed:

1. update the code and tests in the fixing PR
2. update the canonical docs that described the old behavior
3. remove the item here, or move it to a short resolved note with the PR link
4. do not leave a stale mitigation implying the old risk still exists

## Current register

No accepted technical-debt items are currently recorded.

Resolved or removed debt stays in git history and linked PR discussion, not as
stale active-risk text on this page.

## Read next

- [Developer home](README.md)
