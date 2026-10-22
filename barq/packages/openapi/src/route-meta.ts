// Shared contract between `@barqel/barq-app`'s `action` and this
// plugin.
//
// `action(Request, run, docs?)` attaches the validated request's
// metadata to the route handler; `wrapRouter` reads it while the route is
// registered and turns it into a fully documented OpenAPI operation —
// `params`/`query`/`headers`/`body` are derived from the request class, so
// docs can never drift from validation and no `docs.addRoute(...)` call is
// needed.
//
// Unvalidated routes (`action(run, docs?)` without a request class) attach
// docs-only metadata: there is no request schema to derive, but the
// operation still shows up in the spec.
//
// The key is registered globally (`Symbol.for`) on purpose: if two copies of
// this package end up in `node_modules`, both sides still agree on the same
// symbol.
import type { RouteSchema } from "./types";

/** The request part a validated handler reads. */
export type HandlerSource = "body" | "params" | "query" | "headers";

/**
 * Operation metadata accepted by `action`'s third argument. Everything
 * schema-related (`params`, `query`, `headers`, `body`) is derived from the
 * request class and therefore intentionally omitted here.
 */
export type HandlerDocs = Omit<
	RouteSchema,
	"params" | "query" | "headers" | "body"
>;

export interface HandlerRouteMeta {
	/** Which request part the validator reads (absent for unvalidated routes). */
	source?: HandlerSource;
	/**
	 * The schema built from the request's `rules()` (any `toJsonSchema`
	 * input) — absent for unvalidated routes.
	 */
	schema?: unknown;
	/** Optional OpenAPI operation metadata (tags, summary, responses, …). */
	docs?: HandlerDocs;
}

/** Key under which `action` stores metadata on the handler function. */
export const ROUTE_META = Symbol.for("@barqel/barq.handlerMeta");

/**
 * Finds the route handler in a `route.get(pattern, ...args)` argument list and
 * returns its attached metadata, if any.
 */
export function readRouteMeta(
	args: readonly unknown[],
): HandlerRouteMeta | undefined {
	for (const arg of args) {
		if (typeof arg !== "function") continue;

		const meta = (arg as unknown as Record<PropertyKey, unknown>)[ROUTE_META];
		if (meta) return meta as HandlerRouteMeta;
	}

	return undefined;
}

/** Places the request schema in the matching `RouteSchema` slot. */
export function routeSchemaFromMeta(meta: HandlerRouteMeta): RouteSchema {
	const schema: RouteSchema = { ...meta.docs };

	// Docs-only metadata (unvalidated `action(run, docs)`) has no request
	// schema to slot in.
	if (meta.schema === undefined || meta.source === undefined) {
		return schema;
	}

	switch (meta.source) {
		case "params":
			schema.params = meta.schema;
			break;
		case "query":
			schema.query = meta.schema;
			break;
		case "headers":
			schema.headers = meta.schema;
			break;
		default:
			schema.body = meta.schema;
			break;
	}

	return schema;
}
