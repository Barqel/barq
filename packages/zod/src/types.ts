import type { Context, Middleware } from "@barqel/barq";
import type { ZodSchema, ZodType, z } from "zod";

export type ValidationTarget = "body" | "json" | "query" | "params" | "headers";

export type ValidationHook<TOutput> = (
	result:
		| { success: true; data: TOutput }
		| { success: false; error: z.ZodError },
	ctx: Context,
) => Response | void | Promise<Response | void>;

export interface MultiZodSchema {
	body?: ZodType<any, any, any>;
	json?: ZodType<any, any, any>;
	query?: ZodType<any, any, any>;
	params?: ZodType<any, any, any>;
	headers?: ZodType<any, any, any>;
}
