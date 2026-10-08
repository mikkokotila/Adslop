# Security Policy

## Supported scope

Adslop is currently a private specification and repository foundation. No production advertising service or public package release exists. Security maintenance applies to the current main branch and its development tooling.

## Reporting a vulnerability

Send a private report to the maintainer at mailme@mikkokotila.com. Include the affected commit, reproduction steps, expected impact, and relevant logs with credentials and personal data removed. Do not post vulnerability details in a public issue.

When private security reporting is enabled on GitHub, repository members may also use the repository's Security tab. Availability of that service must be verified before treating it as an operational reporting channel.

## Release verification

The repository includes release and optional package-publication tooling. PyPI publication remains disabled until explicitly configured. There are currently no published Adslop distributions or attestations to verify.

The [release policy](docs/Developer/Release-Policy.md) specifies the checks and provenance requirements for future releases. Future release documentation must state which evidence was actually produced.

## Scope

Security review covers repository code, governance gates, dependencies, packaging, release tooling, and documentation configuration. Advertising-account credentials, conversion data, and campaign spending will need concrete security controls as those capabilities are implemented.
