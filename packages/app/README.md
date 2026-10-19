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

## The shape of an app

```
barq.config.ts     # routes + registries (jobs / listeners / commands) + overrides
index.ts           # entrypoint: start(config)
app/               # business logic only
```

```ts
// barq.config.ts
import { defineConfig } from "@barqel/barq-app";

export default defineConfig({
	routes: (app) => app.get("/", () => json({ hello: "world" })),
});
```

```ts
// index.ts
import { start } from "@barqel/barq-app";
import config from "./barq.config";

start(config);
```

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
| CLI | `barq` bin (`*:make`, `env:check`, `app:info`), `runCli`, `loadAppConfig` |
| Generators | `GeneratorCommand`, `pascalCase`, `kebabCase`, `camelCase` |
| Testing | `createTestApp` |
| Vendor | `App`, `Context`, `json`, plugins, `r`/`z`, `container`, `singleton`, … |

## Conventions

- **Config** lives in `barq.config.ts` at the app root; the `barq` CLI loads
  it with `loadAppConfig()`.
- **Registries** are explicit arrays (`jobs`, `listeners`, `commands`) so the
  production bundle stays self-contained — `*:make` generators append to
  them automatically.
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
  `envRules`.

## Scripts

```bash
bun run build       # dist/index.js + dist/*.d.ts
bun run typecheck
bun test
```

MIT
