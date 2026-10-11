import type { Context } from "./context";
import { HttpError } from "./errors";
import type { Params, ResponseHandler } from "./types";

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

export interface LegacyValidator<TOutput> {
	parse(data: unknown): TOutput;
}

export type Validator<TOutput> =
	| LegacyValidator<TOutput>
	| StandardSchemaV1<unknown, TOutput>
	| ((data: unknown) => TOutput | Promise<TOutput>);

export function validateJson<
	TOutput,
	TParams extends object = Params,
	TState extends object = Record<string, unknown>,
>(
	validator: Validator<TOutput>,
	handler: (
		ctx: Context<TParams, TState>,
		body: TOutput,
	) => Response | Promise<Response>,
): ResponseHandler<TParams, TState> {
	return async (ctx) => {
		const raw = await ctx.json<unknown>();
		let body: TOutput;

		if (
			typeof validator === "object" &&
			validator !== null &&
			"~standard" in validator
		) {
			const res = await validator["~standard"].validate(raw);
			if (res.issues) {
				throw new HttpError(422, {
					error: "Validation Failed",
					issues: res.issues,
				});
			}
			body = res.value;
		} else if (typeof validator === "function") {
			body = await validator(raw);
		} else if (
			typeof validator === "object" &&
			validator !== null &&
			"parse" in validator
		) {
			body = (validator as LegacyValidator<TOutput>).parse(raw);
		} else {
			throw new TypeError("Invalid validator provided to validateJson");
		}

		return handler(ctx, body);
	};
}
