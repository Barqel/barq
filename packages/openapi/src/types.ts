import type { Context, HttpMethod, Middleware } from "@barqel/barq";

export interface StandardSchemaV1Issue {
	readonly message: string;
	readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

export type StandardSchemaV1Result<TOutput> =
	| { readonly value: TOutput; readonly issues?: undefined }
	| { readonly issues: ReadonlyArray<StandardSchemaV1Issue> };

export interface StandardSchemaV1<_TInput = unknown, TOutput = unknown> {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) =>
			| StandardSchemaV1Result<TOutput>
			| Promise<StandardSchemaV1Result<TOutput>>;
	};
}

export type SchemaInput = StandardSchemaV1 | Record<string, unknown> | unknown;

export interface RouteSchema {
	tags?: string[];
	summary?: string;
	description?: string;
	operationId?: string;
	deprecated?: boolean;
	security?: Array<Record<string, string[]>>;
	params?: SchemaInput;
	query?: SchemaInput;
	headers?: SchemaInput;
	body?: SchemaInput;
	responses?: Record<
		number | string,
		{
			description: string;
			content?: SchemaInput;
			headers?: Record<string, unknown>;
		}
	>;
}

export interface RouteConfig {
	schema?: RouteSchema;
	middlewares?: Middleware[];
}

export interface OpenAPISecurityScheme {
	type: "apiKey" | "http" | "oauth2" | "openIdConnect";
	description?: string;
	name?: string;
	in?: "query" | "header" | "cookie";
	scheme?: string;
	bearerFormat?: string;
	flows?: Record<string, unknown>;
	openIdConnectUrl?: string;
}

export interface OpenAPIOptions {
	title?: string;
	version?: string;
	description?: string;
	docsPath?: string;
	specPath?: string;
	ui?: "scalar" | "swagger";
	servers?: Array<{ url: string; description?: string }>;
	securitySchemes?: Record<string, OpenAPISecurityScheme>;
}

export interface OpenAPIDocument {
	openapi: string;
	info: {
		title: string;
		version: string;
		description?: string;
	};
	servers?: Array<{ url: string; description?: string }>;
	paths: Record<string, Record<string, unknown>>;
	components?: {
		securitySchemes?: Record<string, OpenAPISecurityScheme>;
		schemas?: Record<string, unknown>;
	};
}

export type ValidatedValues = {
	body?: unknown;
	query?: Record<string, unknown>;
	params?: Record<string, unknown>;
	headers?: Record<string, unknown>;
};
