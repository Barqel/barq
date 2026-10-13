import { type Context, type Middleware, json } from "@barqel/barq";
import { MemoryStore } from "./store";
import type { RateLimitInfo, RateLimitOptions, RateLimitStore } from "./types";

const defaultStore = new MemoryStore();

export function rateLimit(options: RateLimitOptions = {}): Middleware {
	const windowMs = options.windowMs ?? 60_000;
	const maxOption = options.max ?? 100;
	const statusCode = options.statusCode ?? 429;
	const standardHeaders = options.standardHeaders ?? true;
	const legacyHeaders = options.legacyHeaders ?? true;
	const store: RateLimitStore = options.store ?? defaultStore;

	const keyGenerator =
		options.keyGenerator ??
		((ctx: Context) => {
			return ctx.ip || ctx.req.headers.get("x-forwarded-for") || "127.0.0.1";
		});

	return {
		async before(ctx: Context) {
			if (options.skip && (await options.skip(ctx))) {
				return;
			}

			const key = await keyGenerator(ctx);
			const maxLimit =
				typeof maxOption === "function" ? await maxOption(ctx) : maxOption;
			const { totalHits, timeToResetMs, resetTime } = await store.increment(
				key,
				windowMs,
			);

			const remaining = Math.max(0, maxLimit - totalHits);
			const retryAfter = Math.ceil(timeToResetMs / 1000);

			const info: RateLimitInfo = {
				limit: maxLimit,
				current: totalHits,
				remaining,
				resetTime,
				retryAfter,
			};

			const state = ctx.state as Record<string, unknown>;
			state._rateLimitInfo = info;

			const headersToSet = new Headers();
			if (standardHeaders) {
				headersToSet.set("RateLimit-Limit", String(maxLimit));
				headersToSet.set("RateLimit-Remaining", String(remaining));
				headersToSet.set("RateLimit-Reset", String(retryAfter));
			}
			if (legacyHeaders) {
				headersToSet.set("X-RateLimit-Limit", String(maxLimit));
				headersToSet.set("X-RateLimit-Remaining", String(remaining));
				headersToSet.set("X-RateLimit-Reset", String(resetTime));
			}

			state._rateLimitHeaders = headersToSet;

			if (totalHits > maxLimit) {
				headersToSet.set("Retry-After", String(retryAfter));

				if (options.onRateLimit) {
					return options.onRateLimit(ctx, info);
				}

				const body =
					options.message !== undefined
						? options.message
						: {
								error: "Too Many Requests",
								message: `Rate limit exceeded, retry in ${retryAfter} seconds`,
								retryAfter,
							};

				const response =
					typeof body === "string"
						? new Response(body, { status: statusCode })
						: json(body, statusCode);

				for (const [k, v] of headersToSet.entries()) {
					response.headers.set(k, v);
				}

				return response;
			}
		},

		after(ctx: Context, res: Response) {
			const state = ctx.state as Record<string, unknown>;
			const rlHeaders = state._rateLimitHeaders as Headers | undefined;

			if (rlHeaders) {
				const headers = new Headers(res.headers);
				for (const [k, v] of rlHeaders.entries()) {
					if (!headers.has(k)) {
						headers.set(k, v);
					}
				}

				return new Response(res.body, {
					status: res.status,
					statusText: res.statusText,
					headers,
				});
			}

			return res;
		},
	};
}
