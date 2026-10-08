# Python package

`Adslop` is the seed package renamed by repository bootstrap.

## Canonical documentation

The root [README](../README.md) owns the product boundary and first success. The [documentation hub](../docs/README.md) owns reader routing.

## Ownership

This package owns the repository's public Python surface. It does not own repository governance or documentation assembly.

## Public entry points

The seed exports no runtime symbols. Bootstrap preserves that empty, explicit public surface:

```python
import Adslop

assert Adslop.__all__ == []
```

## Adjacent surfaces

- `governance/` owns mechanical repository law.
- `docs-site/` owns documentation assembly and rendering.
- `tests/package/` owns public package proof.

## Read next

Replace this page when the package gains its first real public capability.
