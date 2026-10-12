import { toJsonSchema } from "./json-schema";
import type { OpenAPIDocument, OpenAPIOptions, RouteSchema } from "./types";

export function toOpenApiPath(pattern: string): string {
	return pattern
		.replace(/:([a-zA-Z0-9_]+)\?/g, "{$1}")
		.replace(/:([a-zA-Z0-9_]+)/g, "{$1}")
		.replace(/\*([a-zA-Z0-9_]+)/g, "{$1}");
}

export class OpenAPIRegistry {
	private readonly document: OpenAPIDocument;

	constructor(options: OpenAPIOptions = {}) {
		this.document = {
			openapi: "3.1.0",
			info: {
				title: options.title ?? "API Documentation",
				version: options.version ?? "1.0.0",
				description: options.description,
			},
			servers: options.servers,
			paths: {},
			components: {
				securitySchemes: options.securitySchemes,
				schemas: {},
			},
		};
	}

	addRoute(method: string, pattern: string, schema?: RouteSchema): void {
		if (method === "HEAD") return;

		const path = toOpenApiPath(pattern);
		const paths = this.document.paths;
		if (!paths[path]) {
			paths[path] = {};
		}

		const operationMethod = method.toLowerCase();
		const parameters: Array<Record<string, unknown>> = [];

		const pathMatches = pattern.matchAll(/:([a-zA-Z0-9_]+)(\?)?/g);
		const schemaParams = schema?.params ? toJsonSchema(schema.params).properties as Record<string, unknown> | undefined : undefined;

		for (const match of pathMatches) {
			const name = match[1]!;
			const isOptional = match[2] === "?";
			const paramSchema = schemaParams?.[name] ?? { type: "string" };

			parameters.push({
				name,
				in: "path",
				required: !isOptional,
				schema: paramSchema,
			});
		}

		if (schema?.query) {
			const querySchema = toJsonSchema(schema.query);
			const props = (querySchema.properties as Record<string, unknown>) ?? {};
			const requiredKeys = new Set((querySchema.required as string[]) ?? []);

			for (const [key, prop] of Object.entries(props)) {
				parameters.push({
					name: key,
					in: "query",
					required: requiredKeys.has(key),
					schema: prop,
				});
			}
		}

		if (schema?.headers) {
			const headerSchema = toJsonSchema(schema.headers);
			const props = (headerSchema.properties as Record<string, unknown>) ?? {};
			const requiredKeys = new Set((headerSchema.required as string[]) ?? []);

			for (const [key, prop] of Object.entries(props)) {
				parameters.push({
					name: key,
					in: "header",
					required: requiredKeys.has(key),
					schema: prop,
				});
			}
		}

		let requestBody: Record<string, unknown> | undefined;
		if (schema?.body) {
			requestBody = {
				required: true,
				content: {
					"application/json": {
						schema: toJsonSchema(schema.body),
					},
				},
			};
		}

		const responses: Record<string, unknown> = {};
		if (schema?.responses) {
			for (const [status, res] of Object.entries(schema.responses)) {
				responses[String(status)] = {
					description: res.description,
					content: res.content
						? {
								"application/json": {
									schema: toJsonSchema(res.content),
								},
							}
						: undefined,
					headers: res.headers,
				};
			}
		} else {
			responses["200"] = { description: "Successful operation" };
		}

		paths[path][operationMethod] = {
			tags: schema?.tags,
			summary: schema?.summary,
			description: schema?.description,
			operationId: schema?.operationId,
			deprecated: schema?.deprecated,
			security: schema?.security,
			parameters: parameters.length > 0 ? parameters : undefined,
			requestBody,
			responses,
		};
	}

	getDocument(): OpenAPIDocument {
		return this.document;
	}
}
