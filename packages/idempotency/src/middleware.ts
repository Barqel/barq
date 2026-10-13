import { type Context, HttpError, type Middleware, json } from "@barqel/barq";
import { MemoryIdempotencyStore } from "./store";
import type { IdempotencyOptions, IdempotencyStore } from "./types";

const defaultStore = new MemoryIdempotencyStore();

export function idempotency(options: IdempotencyOptions = {}): Middleware {
	const headerName = options.headerName?.toLowerCase() ?? "idempotency-key";
	const ttlMs = options.ttlMs ?? 86400000; // 24 hours
	const store: IdempotencyStore = options.store ?? defaultStore;
	const enforceHeader = options.enforceHeader ?? false;

	return {
		async before(ctx: Context) {
			if (
				ctx.req.method === "GET" ||
				ctx.req.method === "HEAD" ||
				ctx.req.method === "OPTIONS"
			)
				return;

			const key = ctx.req.headers.get(headerName);

			if (!key) {
				if (enforceHeader) {
					const body = options.errorMessage ?? {
						error: "Bad Request",
						message: `Missing ${headerName} header`,
					};
					throw new HttpError(400, body);
				}
				return;
			}

			const record = await store.get(key);

			if (record) {
				if (record.status === "IN_PROGRESS") {
					const body = options.conflictMessage ?? {
						error: "Conflict",
						message: "Concurrent request in progress for this idempotency key",
					};
					const res =
						typeof body === "string"
							? new Response(body, { status: 409 })
							: json(body, 409);
					res.headers.set("retry-after", "1");
					return res;
				}

				if (record.status === "DONE" && record.response) {
					const headers = new Headers(record.response.headers);
					headers.set("x-idempotent-replayed", "true");
					return new Response(record.response.body, {
						status: record.response.status,
						headers,
					});
				}
			}

			await store.set(key, {
				status: "IN_PROGRESS",
				expiresAt: Date.now() + ttlMs,
			});
			(ctx.state as Record<string, unknown>)._idempotencyKey = key;
		},

		async after(ctx: Context, res: Response) {
			const key = (ctx.state as Record<string, unknown>)._idempotencyKey as
				| string
				| undefined;
			if (!key) return res;

			try {
				const clone = res.clone();
				const bodyBuffer = await clone.arrayBuffer();
				const headersRecord: Record<string, string> = {};

				res.headers.forEach((value, k) => {
					headersRecord[k] = value;
				});

				await store.set(key, {
					status: "DONE",
					response: {
						status: res.status,
						headers: headersRecord,
						body: bodyBuffer,
					},
					expiresAt: Date.now() + ttlMs,
				});
			} catch {
				await store.delete(key);
			}

			return res;
		},
	};
}
