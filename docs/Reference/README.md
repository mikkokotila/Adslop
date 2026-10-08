# Documentation configuration

`docs-site/product-docs.json` owns documentation identity and coordinates.
`docs-site/docs-map.json` owns the maintained source inventory and route map.
These files configure documentation, not advertising accounts or campaigns.

## Product profile

| Field | Current value or contract |
|---|---|
| `productId` | `adslop`, the stable lowercase identifier |
| `productName` | `Adslop`, the reader-visible name |
| `tagline` | a sentence describing this documentation's current scope |
| `siteUrl` | `http://127.0.0.1:3100`, a local preview origin |
| `basePath` | `/`, a root-path preview |
| `sourceRepoUrl` | the private `mikkokotila/Adslop` repository on GitHub |

No production hostname has been selected. Before publication, the maintainer
must choose a host, configure its origin and base path, and validate its
redirects, security headers, access policy, and rollback behavior. The local
origin is not evidence of a public deployment.

## Route map

Every section declares `dir`, `label`, `position`, `slug`, and `description`.
Every document declares one `source`, `dest`, and `slug`; navigation position
and label are optional. Sources, destinations, and slugs are unique, and each
source must resolve to a file inside the repository.

The following entry maps the actual specification as a planned product:

```json
{
  "source": "SPECIFICATION.md",
  "dest": "overview/specification.md",
  "slug": "/overview/specification",
  "sidebarPosition": 2,
  "sidebarLabel": "Product specification (planned)"
}
```

Generated files under `docs-site/.generated` and `docs-site/build` are never
authored. Relative links between mapped sources become site links; other
existing repository files link to their GitHub source and require access to
the private repository.

## Private repository links

The external-link checker uses `GITHUB_TOKEN` only for the configured GitHub
repository and recognized repository, file, directory, issue, pull-request,
and release URL shapes. It translates these to fixed `api.github.com`
endpoints. Authenticated redirects are rejected, and credentials are never
forwarded to public links or another repository. HTTP failures still fail the
check. Use relative links for repository files whenever possible.

## Adjacent surfaces

- [Product specification](../../SPECIFICATION.md): planned product requirements.
- [Configuration](../Developer/Configuration.md): governance settings and budgets.
- [Documentation system](../Developer/Documentation-System.md): rendering,
  accessibility, route, and verification contracts.

## Read next

Follow the [local build guide](../Guides/README.md) after editing the profile
or source map.
