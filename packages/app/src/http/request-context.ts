// Request-scoped `Context` access via `AsyncLocalStorage`.
//
// Lets any layer (services, repositories, loggers, validators) read the
// current request's `Context` without threading it through every signature:
//
//   import { ctx } from "@barqel/barq-app";
//   const t = ctx()?.t;
//
// Lifecycle contract (verified against the Barq dispatcher's implementation):
// - The store is born in the FIRST global middleware (`requestContextMiddleware`),
//   which runs after routing (`trie.match`) and after the per-request `Context`
//   is constructed. Before that point `ctx()` returns `null`.
// - Everything downstream of that point (remaining middlewares, route chain,
//   handler, error resolver, `after` hooks) executes promise-chained from the
//   same dispatch call in the request's own async tree, so the store is visible
//   there — including concurrent requests in different languages.
// - `ctx()` returns `null` whenever no `Context` exists, even mid-HTTP:
//   outside any request (startup, CLI, tests), on synchronous failures before
//   the pipeline runs, and on static context-free routes (e.g. zero-arg
//   handlers served as precomputed responses with no `Context` at all).
//
// Rules:
// - Keep explicit `ctx` parameters at HTTP boundaries (controllers, services
//   that already receive it). Use `ctx()` only where plumbing is noise.
// - Never cache `ctx()` results in module-level state.
// - `runWithCtx()` is an explicit tool for tests and scripts that need a
//   fabricated scope — not a way to fake a request scope in production code.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "@barqel/barq";
import type { TranslateFunction } from "@barqel/barq-i18n";

const storage = new AsyncLocalStorage<Context>();

// Current request's `Context`, or `null` when no request scope exists.
export function ctx(): Context | null {
	return storage.getStore() ?? null;
}

// Current request's `Context`, or a plain `Error` when no scope exists.
// Plain `Error` (not `HttpError`) on purpose: inside the pipeline it still
// surfaces as HTTP 500 via `onError`, while in CLI/tests it reads as a
// normal programming error instead of an HTTP-shaped object.
export function requireCtx(): Context {
	const current = storage.getStore();

	if (!current) {
		throw new Error(
			"Request context is not available. Call inside a request scope, " +
				"or wrap tests/scripts with runWithCtx().",
		);
	}

	return current;
}

// Runs `fn` inside an explicit `Context` scope. For tests and scripts only.
export function runWithCtx<T>(context: Context, fn: () => T): T {
	return storage.run(context, fn);
}

// Request-locale translator shortcuts: `t("users.created")` behaves exactly
// like `ctx.t("users.created")` — same lookup, same interpolation, same
// request language. `__` is the conventional alias of `t`.
// Outside a request scope both throw (via `requireCtx()`): a locale only
// exists inside a request, so translating without one is a programming error.
export function t(
	key: string,
	params?: Record<string, string | number>,
): string {
	return requireCtx().t(key, params);
}

export const __: TranslateFunction = t;

// Must be the FIRST global middleware: `before` has no `next()` in Barq's
// model, so `enterWith` here is the only non-invasive integration point.
// Everything chained after it in the request's async tree inherits the store.
export const requestContextMiddleware = {
	before(routeCtx: Context): void {
		storage.enterWith(routeCtx);
	},
};
