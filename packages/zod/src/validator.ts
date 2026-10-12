import { type Context, HttpError, type Middleware } from "@barqel/barq";
import type { ZodType, z } from "zod";
import type { MultiZodSchema, ValidationHook, ValidationTarget } from "./types";

async function extractTargetData(ctx: Context, target: ValidationTarget): Promise<unknown> {
	switch (target) {
		case "body":
		case "json": {
			if (ctx.req.method === "GET" || ctx.req.method === "HEAD") return {};
			try {
				return await ctx.json();
			} catch {
				throw new HttpError(400, { error: "Bad Request", message: "Malformed JSON payload" });
			}
		}
		case "query": {
			const map: Record<string, string | string[]> = Object.create(null);
			ctx.query.forEach((val, key) => {
				const all = ctx.queryParamAll(key);
				map[key] = all.length > 1 ? all : val;
			});
			return map;
		}
		case "params":
			return ctx.params;
		case "headers": {
			const headersMap: Record<string, string> = Object.create(null);
			ctx.req.headers.forEach((val, key) => {
				headersMap[key] = val;
			});
			return headersMap;
		}
		default:
			return {};
	}
}

export function zValidator<TSchema extends ZodType<any, any, any>>(
	target: ValidationTarget,
	schema: TSchema,
	hook?: ValidationHook<z.output<TSchema>>,
): Middleware {
	return {
		async before(ctx: Context) {
			const data = await extractTargetData(ctx, target);
			const result = await schema.safeParseAsync(data);

			if (hook) {
				const hookRes = await hook(result as any, ctx);
				if (hookRes instanceof Response) return hookRes;
			}

			if (!result.success) {
				throw new HttpError(422, {
					error: "Validation Failed",
					target,
					issues: result.error.issues,
				});
			}

			const state = ctx.state as Record<string, unknown>;
			const validMap = ((ctx.valid as Record<string, unknown>) ?? Object.create(null)) as Record<string, unknown>;
			const normalizedTarget = target === "json" ? "body" : target;

			validMap[normalizedTarget] = result.data;
			ctx.valid = validMap;
			state.valid = validMap;
		},
	};
}

export function validateZod(schemas: MultiZodSchema): Middleware {
	return {
		async before(ctx: Context) {
			const validMap = ((ctx.valid as Record<string, unknown>) ?? Object.create(null)) as Record<string, unknown>;
			const entries = Object.entries(schemas) as Array<[ValidationTarget, ZodType<any, any, any>]>;

			for (const [target, schema] of entries) {
				if (!schema) continue;
				const data = await extractTargetData(ctx, target);
				const result = await schema.safeParseAsync(data);

				if (!result.success) {
					throw new HttpError(422, {
						error: "Validation Failed",
						target,
						issues: result.error.issues,
					});
				}

				const normalizedTarget = target === "json" ? "body" : target;
				validMap[normalizedTarget] = result.data;
			}

			ctx.valid = validMap;
			(ctx.state as Record<string, unknown>).valid = validMap;
		},
	};
}
