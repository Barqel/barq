# Publishing

The workspace publishes one package per directory in `packages/`, plus the
HTTP core in the repository root. Every package is published on its own,
under the `@barqel` scope.

| Package | Directory | What it is |
| --- | --- | --- |
| `@barqel/barq` | `.` (root) | The HTTP core — router, middleware, context, WebSockets |
| `@barqel/barq-cli` | `packages/cli` | The argument parser behind the `barq` command |
| `@barqel/barq-compress` | `packages/compress` | `br` / `gzip` / `deflate` responses |
| `@barqel/barq-cron` | `packages/cron` | Cron expressions, presets and the scheduler |
| `@barqel/barq-email` | `packages/email` | Transactional email, powered by nodemailer |
| `@barqel/barq-env` | `packages/env` | The validated environment parser |
| `@barqel/barq-events` | `packages/events` | The typed event bus |
| `@barqel/barq-helmet` | `packages/helmet` | The security headers |
| `@barqel/barq-i18n` | `packages/i18n` | The translation middleware |
| `@barqel/barq-idempotency` | `packages/idempotency` | Idempotent write routes |
| `@barqel/barq-logger` | `packages/logger` | The structured logger |
| `@barqel/barq-openapi` | `packages/openapi` | The OpenAPI registry and the docs UI |
| `@barqel/barq-orm` | `packages/orm` | The query builder and the model layer |
| `@barqel/barq-rate-limit` | `packages/rate-limit` | The rate limiter and its stores |
| `@barqel/barq-static` | `packages/static` | Static file serving |
| `@barqel/barq-app` | `packages/app` | The application framework — the kernel, the base classes, the generators |

## Before the first publish

```bash
npm login          # once per machine
bun install        # the workspace links
```

### Line endings

The repository is formatted with LF and `.gitattributes` keeps the
checkout that way. A tree that was checked out before it (Windows,
`core.autocrlf=true`) carries CRLF everywhere and Biome refuses the
files — one command fixes it:

```bash
bun run eol
```

Git stores LF either way, so the change is invisible to the repository.

## What is on npm

The local sources move faster than the published versions — the script
compares the built `dist/` of every package with the tarball on npm and
prints what changed:

```bash
bun run publish:diff
```

```
@barqel/barq-cron@1.0.1 — DIFFERS from npm
    only local: presets.d.ts, presets.d.ts.map
    changed:    index.d.ts, index.js, index.js.map
@barqel/barq-env@1.0.0 — DIFFERS from npm
    changed:    index.js.map
@barqel/barq-email@1.0.0 — NOT PUBLISHED
```

A package whose version already exists on npm cannot be published again —
bump its version in `package.json` before publishing it.

## Publishing one package

The sibling packages are linked with `file:` paths, so the monorepo always
runs the local sources. npm needs the published ranges instead, so the
script swaps the links for the real versions, publishes, and puts the
links back:

```bash
bun run publish:package email          # @barqel/barq-email
bun run publish:package email --dry-run
bun run publish:package email --tag next
```

- A package whose version is already on npm is skipped — npm refuses to
  publish over a published version, so bump it first.
- `npm publish` runs the package's `prepublishOnly` script first — the
  lint, the type check, the tests and the build all have to pass.
- The manifest is restored afterwards, even when the publish fails; a
  `package.json.publish-backup` file guards an interrupted run.

## Publishing everything

```bash
bun run publish:all --dry-run
bun run publish:all
```

The order matters: the HTTP core first, then the plugins, then the
application framework — every package depends on the ones before it. The
packages that are already published at their version are skipped.

## After the publish

The starter kit (`../app`) can then move from the local links to the
published versions:

```jsonc
{
	"dependencies": {
		"@barqel/barq-app": "^1.0.0"
	}
}
```

## Versioning

The packages are versioned independently: a patch for a fix, a minor for a
feature, a major for a breaking change. The application framework follows
the plugins it re-exports — when a plugin ships a new feature, the
framework's range moves with it.
