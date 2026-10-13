import { type Context, type Middleware, empty } from "@barqel/barq";
import { computeEtag } from "./etag";
import { MemoryCacheStore } from "./store";
import type { CacheOptions, CacheStore } from "./types";

const defaultStore = new MemoryCacheStore();

export function cache(options: CacheOptions = {}): Middleware {
	const ttlMs = options.ttlMs ?? 60_000;
	const methods = options.methods ?? ["GET", "HEAD"];
	const enableEtag = options.enableEtag ?? true;
	const cacheControl = options.cacheControl ?? true;
	const store: CacheStore = options.store ?? defaultStore;

	const keyGenerator =
		options.keyGenerator ??
		((ctx: Context) => {
			return `${ctx.req.method}:${ctx.req.url}`;
		});

	return {
		async before(ctx: Context) {
			if (!methods.includes(ctx.req.method)) return;
			if (options.skip && (await options.skip(ctx))) return;

			const key = await keyGenerator(ctx);
			const state = ctx.state as Record<string, unknown>;
			state._cacheKey = key;

			const entry = await store.get(key);
			if (!entry) return;

			state._cacheHit = true;

			if (enableEtag && entry.etag) {
				const ifNoneMatch = ctx.req.headers.get("if-none-match");
				if (ifNoneMatch === entry.etag) {
					const res304 = empty(304);
					res304.headers.set("etag", entry.etag);
					if (cacheControl) {
						res304.headers.set(
							"cache-control",
							`public, max-age=${Math.floor(ttlMs / 1000)}`,
						);
					}
					return res304;
				}
			}

			const headers = new Headers(entry.headers);
			if (enableEtag && entry.etag) headers.set("etag", entry.etag);
			if (cacheControl)
				headers.set(
					"cache-control",
					`public, max-age=${Math.floor(ttlMs / 1000)}`,
				);
			headers.set("x-cache", "HIT");

			if (ctx.req.method === "HEAD") {
				return new Response(null, {
					status: entry.status,
					headers,
				});
			}

			return new Response(entry.body, {
				status: entry.status,
				headers,
			});
		},

		async after(ctx: Context, res: Response) {
			if (!methods.includes(ctx.req.method)) return res;
			if (res.status !== 200) return res;

			const state = ctx.state as Record<string, unknown>;
			if (state._cacheHit) return res;

			const key = state._cacheKey as string | undefined;
			if (!key) return res;

			try {
				const clone = res.clone();
				const bodyBuffer = await clone.arrayBuffer();

				const headersRecord: Record<string, string> = {};
				const finalHeaders = new Headers(res.headers);

				res.headers.forEach((value, key) => {
					headersRecord[key] = value;
				});

				let etag: string | undefined;
				if (enableEtag) {
					etag = computeEtag(bodyBuffer);
					finalHeaders.set("etag", etag);
				}

				if (cacheControl) {
					finalHeaders.set(
						"cache-control",
						`public, max-age=${Math.floor(ttlMs / 1000)}`,
					);
				}

				finalHeaders.set("x-cache", "MISS");

				await store.set(key, {
					body: bodyBuffer,
					headers: headersRecord,
					status: res.status,
					etag,
					expiresAt: Date.now() + ttlMs,
				});

				return new Response(res.body, {
					status: res.status,
					statusText: res.statusText,
					headers: finalHeaders,
				});
			} catch {
				return res;
			}
		},
	};
}
