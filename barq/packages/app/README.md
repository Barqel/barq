# @barqel/barq-app

The Barq application framework: a batteries-included kernel, base classes,
`*:make` generators, console CLI and testing helpers for building
applications with [Barq](https://github.com/Barqel/barq) + Bun.

One dependency installs the whole stack — HTTP core, plugins (i18n, cron,
events, rate-limit, idempotency, OpenAPI, helmet, compress, logger,
static), DI (tsyringe) and validation (zod).

## Install

```bash
bun add @barqel/barq-app
```

The `barq` CLI runs on both Bun and Node.js. On Node.js (20.6 or newer) it
uses the bundled `bin/node-loader.js` to resolve `tsconfig.json` `paths` and
transpile app TypeScript (including decorators), so keep `typescript`
installed. The cross-runtime entrypoint is `bin/barq.js`; `bin/barq.ts`
remains for Bun.

## Import it as `@barq`

Applications import the framework through the short `@barq` alias. Map it
once in the app `tsconfig.json` — Bun reads tsconfig paths at runtime, so
the alias works in the editor, in `bun run` and in the `barq` CLI:

```jsonc
{
	"compilerOptions": {
		"paths": {
			"@barq": ["./node_modules/@barqel/barq-app"]
		}
	}
}
```

The `*:make` generators create the mapping for you when it is missing.

## The shape of an app

```
app/config/app.ts  # routes + registries (jobs / listeners / commands) + overrides
index.ts            # entrypoint: start(config)
app/                # business logic only
```

```ts
// app/config/app.ts
import { defineConfig } from "@barq";

export default defineConfig({
	routes: (app) => app.get("/", () => json({ hello: "world" })),
});
```

```ts
// index.ts
import { start } from "@barq";
import config from "./app/config/app";

start(config);
```

## Passwords & encryption

Two services, both static — no `new` needed:

```ts
import { Crypt, Hash, Password } from "@barq";

// Hashing — one way, by design.
const hashed = await Hash.make("Hassan");
await Hash.check("Hassan", hashed); // → true
Hash.needsRehash(hashed); // → false (the work factor changed → re-hash it)

// Encryption — reversible, for secrets (API keys, tokens).
const payload = Crypt.encryptString("sk_live_123");
Crypt.decryptString(payload); // → "sk_live_123"

// Rules — Laravel's `Password::min(8)->mixedCase()->numbers()`.
const rule = Password.of().min(8).mixedCase().numbers();
rule.validate("Passw0rd"); // → true
rule.assert("weak"); // → throws WeakPasswordError
```

| Service | Driver | Notes |
| --- | --- | --- |
| `Hash` | `scrypt` (default), `bcrypt`, `argon2id` | The driver comes from `HASH_DRIVER`. scrypt lives in `node:crypto`, so a hash made on Bun verifies on Node.js too; bcrypt and argon2id go through `Bun.password` (Bun only). `HASH_VERIFY=false` accepts hashes made with another algorithm (migrations). |
| `Crypt` | AES-256-CBC + HMAC-SHA256 | The key comes from `APP_KEY` (base64, 32 bytes) and `APP_PREVIOUS_KEYS` holds the retired keys — decryption falls back to them, so rotating the key never breaks what is already stored. Generate one with `bun run cli key:generate`. |

## Strings

Laravel's `Str` helper, complete, with no dependency — plus the fluent
`Stringable` counterpart:

```ts
import { Str, str } from "@barq";

Str.after("This is my name", "This is"); // → " my name"
Str.camel("foo_bar"); // → "fooBar"
Str.slug("Laravel 5 Framework"); // → "laravel-5-framework"
Str.matchAll("/bar/", "bar foo bar").all(); // → ["bar", "bar"]
Str.plural("child"); // → "children"
Str.isUuid(Str.uuid7(), 7); // → true

str("foo_bar").camel().upper().toString(); // → "FOOBAR"
str("tony stark").whenContains("tony", (value) => value.title()).toString(); // → "Tony Stark"
```

Slicing, searching, replacing, trimming, case conversions, padding, masking,
truncating, pluralization, Markdown rendering, URL/UUID/ULID helpers — the
whole surface, with Laravel's names and behaviour.

### Arabic plurals

Arabic counts the noun, not just the number — the framework implements the six
counted forms (CLDR's Arabic cardinal rules) and picks them automatically:

```ts
import { ArabicPlural, Str } from "@barq";

Str.counted("مستخدم", 0); // → "0 مستخدم"
Str.counted("مستخدم", 1); // → "1 مستخدم"
Str.counted("مستخدم", 2); // → "2 مستخدمان"   (the dual)
Str.counted("مستخدم", 3); // → "3 مستخدمين"   (the broken plural)
Str.counted("مستخدم", 11); // → "11 مستخدمًا"  (the accusative singular)
Str.counted("مستخدم", 100); // → "100 مستخدم"

Str.counted("معلمة", 2); // → "2 معلمتان"     (feminine — inferred from "ة")
Str.counted("معلمة", 3); // → "3 معلمات"

ArabicPlural.form(3); // → "few"
ArabicPlural.forms("مستخدم"); // → { zero, one, two, few, many, other }
```

Keep the noun in the locale file and let the framework pluralize it in the
request language — `"label": "مستخدم"` / `"label": "user"`.

## Email

The kernel wires the mailer at boot — `app.mail`, the process-wide
`mailer()` and the DI container all point at the same instance:

```ts
import { mailer } from "@barq";

await mailer().send({
  to: "user@example.com",
  template: {
    subject: "Welcome {{ name }}",
    html: "<p>Hello {{ name }}, welcome aboard.</p>",
  },
  data: { name: "Hassan" },
});
```

Mails live with the module that owns them. Scaffold one with a template and
a `send(to, data)` helper:

```sh
bun run cli mail:make welcome           # modules/app/mail/welcome.ts
bun run cli mail:make welcome user      # modules/user/mail/welcome.ts
```

The transport is picked automatically: a configured `MAIL_HOST` means real
SMTP delivery, no host means the message is printed in the terminal instead
of being sent — so a development environment never needs a mail server.
`MAIL_TRANSPORT` picks it by hand (`smtp`, `log`, `json`, `stream`,
`sendmail`).

| Variable | Default | Description |
| --- | --- | --- |
| `MAIL_TRANSPORT` | `auto` | `auto` \| `smtp` \| `log` \| `json` \| `stream` \| `sendmail` |
| `MAIL_HOST` | – | The SMTP host — a host switches `auto` to `smtp` |
| `MAIL_PORT` | `587` | The SMTP port |
| `MAIL_SECURE` | `false` | TLS from the first byte |
| `MAIL_USER` / `MAIL_PASSWORD` | – | The SMTP credentials |
| `MAIL_FROM` | `barq@example.com` | The sender address |
| `MAIL_FROM_NAME` | `Barq` | The sender name |
| `MAIL_REPLY_TO` | – | Where the replies go |
| `MAIL_SUBJECT_PREFIX` | – | A prefix added to every subject |
| `MAIL_RETRIES` | `2` | How many times a failed send is retried |
| `MAIL_RETRY_DELAY` | `500` | The delay before the first retry, in ms |

A failed delivery is retried with a growing delay and then throws a
`MailDeliveryError` carrying the attempt count and the original error.

## What's included

| Area | Exports |
| --- | --- |
| Kernel | `createApp`, `start`, `shutdown`, `defineConfig`, `BarqConfig` |
| Base classes | `Job`, `Listener` (`PayloadOf`), `Command`, `BaseRequest`, `ParamsRequest`, `QueryRequest`, `HeadersRequest` |
| Request handlers | `action(Request, run)` / `action(run)` + `@validatedBy(Request)` → validated route handler + auto OpenAPI docs; `action(run)` without a request class runs unvalidated (`data` = raw `ctx.params`, docs still register) |
| Registries | `registerJobs`, `registerListeners`, `registerCommands` |
| HTTP helpers | `sse`, `sseStream`, `ctx`, `requireCtx`, `t`, `__`, `requestContextMiddleware` |
| Exceptions | `AppException` family, `ValidationException` |
| Middleware | `strictRateLimiter`, `globalRateLimiter`, `idempotencyMiddleware` (localized header + replay), `requireIdempotencyKey` |
| Authored env | `env` (validated), `envRules` + `createEnv` (app-specific vars) |
| CLI | `barq` bin (`*:make`, `key:generate`, `env:check`, `app:info`), `runCli`, `loadAppConfig` |
| Generators | `GeneratorCommand`, `pascalCase`, `kebabCase`, `camelCase` |
| Security | `Hash`, `Crypt`, `Password` + their errors |
| Strings | `Str`, `Stringable`, `str`, `Pluralizer`, `ArabicPlural`, `Uri`, `HtmlString`, `markdown`, `transliterate` |
| Email | `Mailer`, `mailer()`, `emailPlugin`, `renderTemplate` + the mail errors |
| Testing | `createTestApp` |
| Vendor | `App`, `Context`, `json`, plugins, `r`/`z`, `container`, `singleton`, … |

## Conventions

- **Config** lives in `app/config/app.ts` (a root `barq.config.*` still
  works, and the package entrypoint from `module`/`main` is the last
  fallback); the `barq` CLI loads it with `loadAppConfig()`. Entrypoints used
  this way must guard side effects with `import.meta.main`.
- **Registries** are discovered from `modules/<name>/` by `defineConfigAsync`
  (routes, jobs, listeners, commands, locales), so modules are self-contained
  and `index.ts` stays free of per-module wiring.
- **Events** live in their listener — one class carries the event name, the
  payload shape and the handler (`listener:make` scaffolds it); producers
  emit through the class's `event`:

  ```ts
  @injectable()
  export class UserCreatedListener extends Listener.of<{
  	name: string;
  	email: string;
  }>("user.created") {
  	async handle(payload: PayloadOf<this>): Promise<void> { … }
  }

  // producing side
  await eventBus().emit(UserCreatedListener.event, { name, email });
  ```

- **Env**: the framework validates its own variables (`APP_*`, `LOG_LEVEL`,
  `RATE_LIMIT_*`, `IDEMPOTENCY_*`); validate extra ones with `createEnv` +
  `envRules`. `env:make` scaffolds the `.env` / `.env.example` pair at the
  project root.

## Auto-Register System

Barq discovers application components automatically via top-level await and
`defineConfigAsync`.

### Modules (default)

Domain code lives in `modules/<name>/`, and `defineConfigAsync` scans that
directory by default. Every module owns its registries through a fixed layout:

```
modules/user/
  routes/routes.ts     # exactly one route function (or routes.ts)
  routes/<group>.ts    # route groups imported by routes.ts
  jobs/                # Job subclasses
  listeners/           # Listener subclasses
  commands/            # Command subclasses
  locales/<locale>.ts  # dictionaries, deep-merged per locale
  config/              # module-specific settings
```

```ts
export default await defineConfigAsync({ name: "My App" });
```

Adding a module folder is enough: its routes are mounted, and its jobs,
listeners, commands and translations are registered. Locale dictionaries from
every module are deep-merged per language (a later module wins on collisions).
Scaffold a module's route entry with:

```sh
bun run cli module:make billing
```

The remaining folders (`jobs/`, `listeners/`, `commands/`, `locales/`,
`config/`) are optional — create them when the module needs them.

Every component generator (`action:make`, `command:make`, `config:make`,
`controller:make`, `dto:make`, `job:make`, `listener:make`, `locale:make`,
`mail:make`, `middleware:make`, `repository:make`, `request:make`,
`route:make`, `service:make`) accepts an optional trailing module. It
defaults to `app`, so the plain command targets `modules/app/`:

```sh
bun run cli action:make send-otp            # modules/app/actions/send-otp.ts
bun run cli action:make send-otp billing    # modules/billing/actions/send-otp.ts
bun run cli job:make send-report billing    # modules/billing/jobs/send-report.ts
bun run cli mail:make welcome               # modules/app/mail/welcome.ts
bun run cli locale:make en                  # modules/app/locales/en.ts
bun run cli route:make v1 user              # modules/user/routes/v1.ts
bun run cli config:make mail user           # modules/user/config/mail.ts
```

`locale:make` uses the locale code as the file name and therefore as the
dictionary key, and accepts regional codes such as `pt-br`. `route:make`
creates a route group to import from the module's `routes/routes.ts` (the only
route file loaded at boot), and `config:make` writes a module-specific
settings object. Both accept nested names such as `admin/users`.

`env:make` creates the `.env` and `.env.example` pair at the project root.
The framework variables are included with usable defaults, `.env` gets a
fresh `APP_KEY`, and `.env.example` keeps a placeholder key that is safe to
commit:

```sh
bun run cli env:make
```

Existing files are never overwritten unless you pass `--force`; if only one
of the pair is missing, `env:make` creates just that file. Application-specific
variables still use `createEnv` + `envRules` in `modules/shared/config/`.

Jobs, listeners and commands under `modules/<name>/` are auto-discovered, so
the generator does not add them to the flat `jobs` / `listeners` / `commands`
arrays in the app config.

Set `autoRegister: { modules: false }` to opt out, or use
`autoRegister.directories.modules` to scan another folder.

### Flat directories (opt-in)

The original per-registry directories remain available:

```ts
export default await defineConfigAsync({
	name: "My App",
	autoRegister: {
		jobs: true,          // scans app/jobs
		listeners: true,     // scans app/listeners
		commands: true,      // scans app/commands
		translations: true,  // scans app/locales
	},
});
```

### Key Guarantees
- **Zero API Breakage**: `createApp()`, `start()`, and `createTestApp()` remain 100% synchronous.
- **Zero Request-Path Overhead**: Scanning and importing occurs only once at configuration evaluation time (TLA).
- **Manual Priority Always Wins**: Any manual items in `jobs`, `listeners`, `commands`, or `translations` take precedence over discovered items and are deduplicated.
- **Security & Path Confinement**: Discovered paths are strictly validated using canonical `realpath` checks within `PROJECT_ROOT`. Traversal and symlinks outside the root are rejected.
- **Prototype Pollution Defense**: Translation keys (`__proto__`, `constructor`, `prototype`) are rejected.
- **Error Isolation**: Individual file import or syntax errors log non-fatal warnings by default without crashing boot (unless `strict: true`).


## Scripts

```bash
bun run build       # dist/index.js + dist/*.d.ts
bun run typecheck
bun test
```

## Publishing

The sibling packages are linked with `file:` paths (`file:../cron`,
`file:../email`, …) so the monorepo always runs the local sources — a
change in a plugin is picked up without publishing anything. The publish
script swaps the links for the published versions, publishes, and puts the
links back:

```bash
bun run publish:package app --dry-run   # from the repository root
bun run publish:package app
```

See [PUBLISHING.md](../../PUBLISHING.md) for the whole flow.

MIT
