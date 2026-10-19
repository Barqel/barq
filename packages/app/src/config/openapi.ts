// OpenAPI docs defaults — override through `defineConfig({ openapi })`.

export interface AppOpenApiConfig {
	title?: string;
	version?: string;
	description?: string;
	/** HTML docs UI route (Scalar / Swagger). */
	docsPath?: string;
	/** Raw OpenAPI JSON spec route. Must differ from `docsPath`. */
	specPath?: string;
	ui?: "scalar" | "swagger";
}

export interface ResolvedOpenApiConfig {
	title: string;
	version: string;
	description: string;
	docsPath: string;
	specPath: string;
	ui: "scalar" | "swagger";
}

export const DEFAULT_OPENAPI: ResolvedOpenApiConfig = {
	title: "API documentation",
	version: "1.0.0",
	description: "API built with Barq",
	docsPath: "/docs",
	specPath: "/openapi.json",
	ui: "scalar",
};

export function resolveOpenApi(
	config: AppOpenApiConfig = {},
): ResolvedOpenApiConfig {
	return { ...DEFAULT_OPENAPI, ...config };
}
