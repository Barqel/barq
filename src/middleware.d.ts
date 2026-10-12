import type { Context } from "./context";
import type { ErrorResolver, Middleware } from "./types";
type PipelineHandler = (ctx: Context) => Response | Promise<Response>;
export type MiddlewareDispatcher = (ctx: Context, handler: PipelineHandler) => Response | Promise<Response>;
export declare function isThenable(value: unknown): value is PromiseLike<unknown>;
/** Compile a middleware chain once for reuse by native and fallback routes. */
export declare function composeMiddlewareDispatcher(mws: readonly Middleware[], errorResolver?: ErrorResolver): MiddlewareDispatcher;
/** Compile a route-specific chain around its handler. */
export declare function composeMiddlewares(mws: readonly Middleware[], handler: PipelineHandler, errorResolver?: ErrorResolver): PipelineHandler;
export declare function runPipeline(mws: readonly Middleware[], ctx: Context, handler: (ctx: Context) => Response | Promise<Response>, errorResolver?: ErrorResolver): Response | Promise<Response>;
export declare function unwindAfter(mws: readonly Middleware[], ctx: Context, res: Response, enteredCount: number, errorResolver?: ErrorResolver): Response | Promise<Response>;
export {};
//# sourceMappingURL=middleware.d.ts.map