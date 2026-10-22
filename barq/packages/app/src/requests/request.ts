// Request validation engine — picks the Zod locale error map matching the
// request language, reads the configured input source (JSON body by default,
// or path params / query / headers) and turns issues into the app's
// localized 400 envelope.
import type { Context } from "@barqel/barq";
import { ValidationException } from "../http/exceptions";
import { type Rules, r, zodErrorMaps } from "../vendor";

/** The request part a `BaseRequest` validates. */
export type RequestSource = "body" | "params" | "query" | "headers";

// Falls back to English for unknown locales.
function errorMapFor(ctx: Context) {
	const locale = ctx.state.locale;
	return typeof locale === "string" && locale in zodErrorMaps
		? zodErrorMaps[locale as keyof typeof zodErrorMaps]
		: zodErrorMaps.en;
}

async function readJsonBody(ctx: Context): Promise<unknown> {
	// Treat empty bodies as an empty object so missing-body
	// errors surface as translated "required" issues from zod.
	const contentLength = ctx.req.headers.get("content-length");
	if (contentLength === "0") {
		return {};
	}

	try {
		// `ctx.text()` (not `ctx.req.text()`) — the body buffer is cached on
		// the context, so reading it stays safe even if another middleware
		// (e.g. the OpenAPI validator) read it first.
		const text = await ctx.text();
		if (text.trim() === "") {
			return {};
		}
		return JSON.parse(text) as unknown;
	} catch {
		throw new ValidationException([], ctx.t("errors.validation"));
	}
}

async function readSource(
	ctx: Context,
	source: RequestSource,
): Promise<unknown> {
	switch (source) {
		case "params":
			return ctx.params;
		case "query":
			// Repeated keys keep the last value; handlers needing arrays use
			// `ctx.queryParamAll()` instead of this validator.
			return Object.fromEntries(ctx.query);
		case "headers":
			// Header names are case-insensitive — `Headers` yields lowercase.
			return Object.fromEntries(ctx.req.headers);
		default:
			return readJsonBody(ctx);
	}
}

export function defineRequest<const S extends Rules>(
	shape: S,
	source: RequestSource = "body",
) {
	const schema = r.object(shape);

	return async (ctx: Context): Promise<r.output<typeof schema>> => {
		const input = await readSource(ctx, source);
		// Messages arrive already localized via the per-request Zod error map.
		const result = schema.safeParse(input, { error: errorMapFor(ctx) });

		if (!result.success) {
			const errors = result.error.issues.map((issue) => ({
				field:
					issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)",
				code: issue.code,
				message: issue.message,
			}));

			throw new ValidationException(errors, ctx.t("errors.validation"));
		}

		return result.data;
	};
}
