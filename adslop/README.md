# Python package boundary

`adslop/` is the initial Python package. It currently declares an empty public surface. It does not create advertising
campaigns or implement the planned API.

## Canonical documentation

The root [README](../README.md) states current project status. The
[specification](../SPECIFICATION.md) defines intended product behavior, and
the [documentation hub](../docs/README.md) routes readers by task.

## Current entry point

From an environment with this checkout installed:

```python
import adslop

assert adslop.__all__ == []
```

Version information belongs to the project distribution metadata. The module
exports no runtime symbols and has no public campaign methods to call yet.

## Ownership

This package owns the future runtime implementation. `governance/` owns
repository checks, `docs-site/` assembles documentation, and `tests/package/`
contains the package import test. These development tools are separate from
the runtime package.

## Read next

Read the [developer guide](../docs/Developer/README.md) before adding the first
runtime capability and its public documentation.
