import { App, type Context, HttpError, RouteGroup, json } from "@barqel/barq";
import { OpenAPIRegistry } from "./registry";
import type { OpenAPIOptions, RouteConfig, RouteSchema, StandardSchemaV1 } from "./types";
import { renderScalarHtml, renderSwaggerHtml } from "./ui";

export * from "./types";
export { OpenAPIRegistry, toOpenApiPath } from "./registry";
export { toJsonSchema } from "./json-schema";

async function executeValidate(validator: unknown, data: unknown): Promise<unknown> {
	if (!validator) return data;

	if (typeof validator === "object" && validator !== null && "~standard" in validator) {
		const res = await (validator as StandardSchemaV1)["~standard"].validate(data);
		if (res.issues) {
			throw new HttpError(422, {
				error: "Validation Failed",
				issues: res.issues,
			});
		}
		return res.value;
	}

	if (typeof validator === "object" && validator !== null && "parse" in validator) {
		try {
			return (validator as { parse: (d: unknown) => unknown }).parse(data);
		} catch (err) {
			throw new HttpError(422, {
				error: "Validation Failed",
				issues: err,
			});
		}
	}

	return data;
}

function createValidationMiddleware(schema: RouteSchema) {
	return {
		async before(ctx: Context) {
			const validState: Record<string, unknown> = (ctx.valid as Record<string, unknown>) ?? {};

			if (schema.params) {
				validState.params = await executeValidate(schema.params, ctx.params);
			}

			if (schema.query) {
				const queryMap: Record<string, unknown> = Object.create(null);
				ctx.query.forEach((v, k) => {
					queryMap[k] = v;
				});
				validState.query = await executeValidate(schema.query, queryMap);
			}

			if (schema.headers) {
				const headerMap: Record<string, string> = Object.create(null);
				ctx.req.headers.forEach((v, k) => {
					headerMap[k] = v;
				});
				validState.headers = await executeValidate(schema.headers, headerMap);
			}

			if (schema.body && ctx.req.method !== "GET" && ctx.req.method !== "HEAD") {
				const raw = await ctx.json<unknown>();
				validState.body = await executeValidate(schema.body, raw);
			}

			ctx.valid = validState;
		},
	};
}

function isRouteConfig(val: unknown): val is RouteConfig {
	return (
		typeof val === "object" &&
		val !== null &&
		("schema" in val || "middlewares" in val)
	);
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options", "all"] as const;

function wrapRouter(
	router: App<any> | RouteGroup<any, any>,
	registry: OpenAPIRegistry,
	prefix = "",
) {
	for (const method of HTTP_METHODS) {
		const original = (router as Record<string, any>)[method].bind(router);

		(router as Record<string, any>)[method] = (pattern: string, ...args: unknown[]) => {
			const first = args[0];
			if (isRouteConfig(first)) {
				const config = first;
				const remaining = args.slice(1);
				const schema = config.schema;

				if (schema) {
					const fullPath = prefix ? (pattern === "/" ? prefix : `${prefix}${pattern}`) : pattern;
					registry.addRoute(method.toUpperCase(), fullPath, schema);
					const validationMw = createValidationMiddleware(schema);
					return original(pattern, validationMw, ...(config.middlewares ?? []), ...remaining);
				}

				return original(pattern, ...(config.middlewares ?? []), ...remaining);
			}

			return original(pattern, ...args);
		};
	}

	const originalGroup = router.group.bind(router);
	router.group = (subPrefix: string, ...args: unknown[]) => {
		const callback = args[args.length - 1] as (g: RouteGroup<any, any>) => void;
		const restArgs = args.slice(0, -1);
		const fullGroupPrefix = prefix ? `${prefix}${subPrefix}` : subPrefix;

		return originalGroup(subPrefix, ...restArgs, (group: RouteGroup<any, any>) => {
			wrapRouter(group, registry, fullGroupPrefix);
			callback(group);
		});
	};
}

export function openapi(options: OpenAPIOptions = {}) {
	const docsPath = options.docsPath ?? "/docs";
	const specPath = options.specPath ?? "/openapi.json";
	const uiProvider = options.ui ?? "scalar";
	const registry = new OpenAPIRegistry(options);

	return <TState extends object = Record<string, unknown>>(
		app: App<TState>,
	) => {
		wrapRouter(app, registry);

		app.get(specPath, () => json(registry.getDocument()));

		app.get(docsPath, () => {
			const title = options.title ?? "API Documentation";
			const html =
				uiProvider === "swagger"
					? renderSwaggerHtml(specPath, title)
					: renderScalarHtml(specPath, title);

			return new Response(html, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		});

		(app as any).openapi = registry;
	};
}
