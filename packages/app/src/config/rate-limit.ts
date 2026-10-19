// Rate limiting: a global plugin for the whole app (health probe excluded)
// plus a strict limiter for write/auth-style routes.
//
// Limits come from validated env. The 429 body is built via `onRateLimit`
// (not the static `message` option) so it follows the request locale and
// the app's `{ success, message }` error envelope.
//
// NOTE: each limiter gets its own `MemoryStore` — the package default is a
// module-level shared store keyed by client IP only; sharing it would merge
// the global and strict quotas into one counter (POSTs counted twice).
import type { Context } from "@barqel/barq";
import {
	MemoryStore,
	type RateLimitInfo,
	rateLimit,
	rateLimiter,
} from "@barqel/barq-rate-limit";
import { env } from "../kernel/env";

function tooManyResponse(ctx: Context, info: RateLimitInfo): Response {
	const body = JSON.stringify({
		success: false,
		message: ctx.t("errors.rateLimited"),
		retryAfter: info.retryAfter,
	});

	return new Response(body, {
		status: 429,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"Retry-After": String(info.retryAfter),
		},
	});
}

/** Global protection for the whole app (health probe excluded). */
export const globalRateLimiter = rateLimiter({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: env.RATE_LIMIT_MAX,
	store: new MemoryStore(),
	skip: (ctx) => ctx.pathname === "/health",
	onRateLimit: (ctx, info) => tooManyResponse(ctx, info),
});

/** Strict limiter for write routes: `users.post("/", strictRateLimiter, handler)`. */
export const strictRateLimiter = rateLimit({
	windowMs: env.RATE_LIMIT_WINDOW_MS,
	max: env.RATE_LIMIT_STRICT_MAX,
	store: new MemoryStore(),
	onRateLimit: (ctx, info) => tooManyResponse(ctx, info),
});
