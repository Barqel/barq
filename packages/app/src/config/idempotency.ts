// Idempotency guard for write routes — ONE middleware that both enforces the
// `Idempotency-Key` header (localized, app envelope) and replays the first
// response for that key:
//
//   users.post("/", idempotencyMiddleware, handler);
//
// `requireIdempotencyKey` stays exported for the rare case where a route
// wants the header check WITHOUT replay protection — `idempotencyMiddleware`
// already includes it.
//
// Two package constraints shape this file (verified against the package
// implementation):
// 1. `errorMessage`/`conflictMessage` are STATIC — no per-request hook. The
//    missing-header 400 is therefore enforced here (localized) while the
//    package runs with `enforceHeader: false`. The 409 path is a transient
//    race signal (the client retries after `retry-after: 1` and receives the
//    real, localized response), so its static English body is acceptable.
// 2. The package default store is a module-level singleton keyed by client
//    key only, so this module owns a dedicated `MemoryIdempotencyStore`
//    (destroyed on graceful shutdown).
//
// Framework note (verified in Barq's dispatcher): route-level middleware and
// handlers are composed WITHOUT the app `onError` resolver — their errors go
// through the default `errorToResponse`. Hence enforcement must throw a
// fully-formed localized body here instead of relying on `onError`.
//
// Semantics to know: the FIRST response for a key is replayed verbatim —
// including validation 4xx. Resend corrected data with a NEW key.
import { type Context, HttpError, type Middleware } from "@barqel/barq";
import { idempotency, MemoryIdempotencyStore } from "@barqel/barq-idempotency";
import { env } from "../kernel/env";

export const IDEMPOTENCY_HEADER = "idempotency-key";

export const idempotencyStore = new MemoryIdempotencyStore();

/**
 * Localized header enforcement (standalone). Skips naturally-idempotent
 * methods — GET/HEAD/OPTIONS never need a key.
 */
export const requireIdempotencyKey = {
	before(ctx: Context): void {
		if (!env.IDEMPOTENCY_ENFORCE_HEADER) {
			return;
		}

		const method = ctx.req.method;

		if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
			return;
		}

		if (!ctx.req.headers.get(IDEMPOTENCY_HEADER)) {
			throw new HttpError(400, {
				success: false,
				message: ctx.t("errors.idempotencyKeyMissing"),
			});
		}
	},
} satisfies Middleware;

/** Replay engine from the package (no header enforcement of its own). */
const replay = idempotency({
	headerName: IDEMPOTENCY_HEADER,
	ttlMs: env.IDEMPOTENCY_TTL_MS,
	enforceHeader: false,
	store: idempotencyStore,
	// Transient race signal only — see note (1) above.
	conflictMessage: {
		success: false,
		message: "Concurrent request in progress for this idempotency key",
	},
});

/**
 * The single write-route guard: localized `Idempotency-Key` check, then
 * first-response replay (`x-idempotent-replayed: true`) and 409 on concurrent
 * duplicates.
 */
export const idempotencyMiddleware = {
	async before(ctx: Context) {
		requireIdempotencyKey.before(ctx);
		return replay.before?.(ctx);
	},
	after(ctx: Context, res: Response) {
		return replay.after?.(ctx, res);
	},
} satisfies Middleware;
