# TigerAI Enterprise files (".ee")

DRAFT, pending legal review.

Following the same practice as n8n, code that belongs to the paid enterprise
edition is kept in clearly separate files and directories whose names contain
`.ee` (for example `auth-provider.ee.ts`, or a directory `ee/`). Those files are
under the TigerAI Enterprise licence, not under `tigerai/LICENSE`. Using them in
production needs a subscription.

**This repository contains no enterprise code.** The community edition only
defines the extension points (`tigerai/db/driver.ts` for storage,
`startExtensions` in `tigerai/adapter/` for behaviour), with community
implementations behind them. Planned enterprise packages that would plug in
there: PostgreSQL storage (HA), single sign-on (LDAP/AD, SAML/OIDC, Google),
audit export and long-term retention, fine-grained capabilities and shell
levels, centralised logging, CI/CD pipelines.

The community edition never contains an `if (isEnterprise)` branch: an
enterprise package registers itself at startup (for storage:
`registerStoreDriver`) and the community code does not change.
