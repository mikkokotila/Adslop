# Documentation profile

`docs-site/product-docs.json` owns product identity and deployment coordinates. `docs-site/docs-map.json` owns the maintained source inventory and public route map.

## Product profile fields

| Field | Required behavior |
|---|---|
| `productId` | stable lowercase repository identifier |
| `productName` | reader-visible product name |
| `tagline` | one sentence used in metadata and page summaries |
| `siteUrl` | canonical origin without a trailing slash |
| `basePath` | leading and trailing slash, or `/` |
| `sourceRepoUrl` | canonical repository URL used for edit links |

## Route-map fields

Every section declares `dir`, `label`, `position`, `slug`, and `description`. Every document declares one `source`, `dest`, and `slug`; navigation position and label are optional.

Sources, destinations, and slugs must be unique. Every source must exist inside the repository. Generated files under `docs-site/.generated` and `docs-site/build` are never authored.

## Minimum example

```json
{
  "source": "docs/Guides/README.md",
  "dest": "guides/documentation-site.md",
  "slug": "/guides/documentation-site",
  "sidebarPosition": 1
}
```

## Edge cases

- A repository with no package documentation still keeps the Packages section and supplies one package-boundary page.
- A root deployment uses `/` as `basePath`.
- A route change is a public contract change and requires redirects outside this scaffold.

## Read next

Apply the full [documentation system contract](../Developer/Documentation-System.md).
