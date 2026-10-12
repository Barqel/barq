import type { Context } from "./context";
import type { Params, ResponseHandler } from "./types";
export interface StandardSchemaV1Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | {
        readonly key: PropertyKey;
    }>;
}
export type StandardSchemaV1Result<TOutput> = {
    readonly value: TOutput;
    readonly issues?: undefined;
} | {
    readonly issues: ReadonlyArray<StandardSchemaV1Issue>;
};
export interface StandardSchemaV1<_TInput = unknown, TOutput = unknown> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => StandardSchemaV1Result<TOutput> | Promise<StandardSchemaV1Result<TOutput>>;
    };
}
export interface LegacyValidator<TOutput> {
    parse(data: unknown): TOutput;
}
export type Validator<TOutput> = LegacyValidator<TOutput> | StandardSchemaV1<unknown, TOutput> | ((data: unknown) => TOutput | Promise<TOutput>);
export declare function validateJson<TOutput, TParams extends object = Params, TState extends object = Record<string, unknown>>(validator: Validator<TOutput>, handler: (ctx: Context<TParams, TState>, body: TOutput) => Response | Promise<Response>): ResponseHandler<TParams, TState>;
//# sourceMappingURL=validation.d.ts.map