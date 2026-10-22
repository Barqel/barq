import type { Context } from "./context";
import { errorToResponse } from "./errors";
import type { ErrorResolver, Middleware } from "./types";

type PipelineHandler = (ctx: Context) => Response | Promise<Response>;

export type MiddlewareDispatcher = (
	ctx: Context,
	handler: PipelineHandler,
) => Response | Promise<Response>;

export function isThenable(value: unknown): value is PromiseLike<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

function mergeState(ctx: Context, value: unknown): void {
	if (typeof value === "object" && value !== null) {
		Object.assign(ctx.state as Record<string, unknown>, value as object);
	}
}

/** Compile a middleware chain once for reuse by native and fallback routes. */
export function composeMiddlewareDispatcher(
	mws: readonly Middleware[],
	errorResolver?: ErrorResolver,
): MiddlewareDispatcher {
	// Keep pathological chains on the iterative implementation to avoid deep
	// call stacks. The usual short chains are compiled into direct closures.
	if (
		mws.length > 64 ||
		mws.some((middleware) => middleware.after !== undefined)
	) {
		return (ctx, handler) => runPipeline(mws, ctx, handler, errorResolver);
	}

	let next: MiddlewareDispatcher = (ctx, handler) => {
		let result: Response | Promise<Response>;
		try {
			result = handler(ctx);
		} catch (error) {
			return handlePipelineError(mws, ctx, error, mws.length, errorResolver);
		}
		if (isThenable(result)) {
			return Promise.resolve(result).catch((error: unknown) =>
				handlePipelineError(mws, ctx, error, mws.length, errorResolver),
			);
		}
		return result;
	};

	for (let i = mws.length - 1; i >= 0; i--) {
		const middleware = mws[i]!;
		const hook = middleware.before;
		const following = next;
		next = (ctx, handler) => {
			if (!hook) return following(ctx, handler);
			let result: unknown;
			try {
				result = hook(ctx);
			} catch (error) {
				return handlePipelineError(mws, ctx, error, i, errorResolver);
			}
			if (result === undefined) return following(ctx, handler);
			if (isThenable(result)) {
				return Promise.resolve(result).then(
					(value: unknown) => {
						if (value instanceof Response) return value;
						mergeState(ctx, value);
						return following(ctx, handler);
					},
					(error: unknown) =>
						handlePipelineError(mws, ctx, error, i, errorResolver),
				);
			}
			if (result instanceof Response) return result;
			mergeState(ctx, result);
			return following(ctx, handler);
		};
	}

	return next;
}

/** Compile a route-specific chain around its handler. */
export function composeMiddlewares(
	mws: readonly Middleware[],
	handler: PipelineHandler,
	errorResolver?: ErrorResolver,
): PipelineHandler {
	const dispatch = composeMiddlewareDispatcher(mws, errorResolver);
	return (ctx) => dispatch(ctx, handler);
}

export function runPipeline(
	mws: readonly Middleware[],
	ctx: Context,
	handler: (ctx: Context) => Response | Promise<Response>,
	errorResolver?: ErrorResolver,
): Response | Promise<Response> {
	let i = 0;
	const len = mws.length;

	while (i < len) {
		const hook = mws[i]!.before;
		if (hook) {
			let r: unknown;
			try {
				r = hook(ctx);
			} catch (err) {
				return handlePipelineError(mws, ctx, err, i, errorResolver);
			}
			if (r !== undefined) {
				if (r instanceof Response) {
					return unwindAfter(mws, ctx, r, i + 1, errorResolver);
				}
				if (isThenable(r)) {
					return resumeBefore(mws, ctx, handler, r, i, errorResolver);
				}
				mergeState(ctx, r);
			}
		}
		i++;
	}

	return invokeHandler(mws, ctx, handler, len, errorResolver);
}

function continueBefore(
	mws: readonly Middleware[],
	ctx: Context,
	handler: (ctx: Context) => Response | Promise<Response>,
	startIndex: number,
	errorResolver?: ErrorResolver,
): Response | Promise<Response> {
	let i = startIndex;
	const len = mws.length;
	while (i < len) {
		const hook = mws[i]!.before;
		if (hook) {
			let r: unknown;
			try {
				r = hook(ctx);
			} catch (err) {
				return handlePipelineError(mws, ctx, err, i, errorResolver);
			}
			if (r !== undefined) {
				if (r instanceof Response) {
					return unwindAfter(mws, ctx, r, i + 1, errorResolver);
				}
				if (isThenable(r)) {
					return resumeBefore(mws, ctx, handler, r, i, errorResolver);
				}
				mergeState(ctx, r);
			}
		}
		i++;
	}
	return invokeHandler(mws, ctx, handler, len, errorResolver);
}

function invokeHandler(
	mws: readonly Middleware[],
	ctx: Context,
	handler: (ctx: Context) => Response | Promise<Response>,
	entered: number,
	errorResolver?: ErrorResolver,
): Response | Promise<Response> {
	let res: Response | Promise<Response>;
	try {
		res = handler(ctx);
	} catch (err) {
		return handlePipelineError(mws, ctx, err, entered, errorResolver);
	}
	if (isThenable(res)) {
		return resumeHandler(mws, ctx, res, entered, errorResolver);
	}
	return unwindAfter(mws, ctx, res, entered, errorResolver);
}

function resumeBefore(
	mws: readonly Middleware[],
	ctx: Context,
	handler: (ctx: Context) => Response | Promise<Response>,
	promise: PromiseLike<unknown>,
	index: number,
	errorResolver?: ErrorResolver,
): Promise<Response> {
	return Promise.resolve(promise).then(
		(r) => {
			if (r instanceof Response) {
				return unwindAfter(mws, ctx, r, index + 1, errorResolver);
			}
			mergeState(ctx, r);
			return continueBefore(mws, ctx, handler, index + 1, errorResolver);
		},
		(err: unknown) => handlePipelineError(mws, ctx, err, index, errorResolver),
	);
}

function resumeHandler(
	mws: readonly Middleware[],
	ctx: Context,
	promise: PromiseLike<unknown>,
	entered: number,
	errorResolver?: ErrorResolver,
): Promise<Response> {
	return Promise.resolve(promise).then(
		(res) => unwindAfter(mws, ctx, res as Response, entered, errorResolver),
		(err: unknown) =>
			handlePipelineError(mws, ctx, err, entered, errorResolver),
	);
}

function handlePipelineError(
	mws: readonly Middleware[],
	ctx: Context,
	err: unknown,
	entered: number,
	errorResolver?: ErrorResolver,
): Response | Promise<Response> {
	if (errorResolver !== undefined) {
		let res: Response | Promise<Response>;
		try {
			res = errorResolver(err, ctx);
		} catch (resolverErr) {
			const fallback = errorToResponse(resolverErr, ctx.development);
			return unwindAfter(mws, ctx, fallback, entered, errorResolver);
		}
		if (isThenable(res)) {
			return (res as Promise<Response>).then(
				(resolved) => unwindAfter(mws, ctx, resolved, entered, errorResolver),
				(resolverErr) => {
					const fallback = errorToResponse(resolverErr, ctx.development);
					return unwindAfter(mws, ctx, fallback, entered, errorResolver);
				},
			);
		}
		return unwindAfter(mws, ctx, res as Response, entered, errorResolver);
	}
	const res = errorToResponse(err, ctx.development);
	return unwindAfter(mws, ctx, res, entered, errorResolver);
}

export function unwindAfter(
	mws: readonly Middleware[],
	ctx: Context,
	res: Response,
	enteredCount: number,
	errorResolver?: ErrorResolver,
): Response | Promise<Response> {
	let currentRes = res;

	for (let j = enteredCount - 1; j >= 0; j--) {
		const hook = mws[j]!.after;
		if (hook) {
			let r: unknown;
			try {
				r = hook(ctx, currentRes);
			} catch (err) {
				if (errorResolver !== undefined) {
					try {
						const resolved = errorResolver(err, ctx);
						if (isThenable(resolved)) {
							return (resolved as Promise<Response>).then(
								(resolvedRes) =>
									continueUnwind(mws, ctx, j - 1, resolvedRes, errorResolver),
								(resolverErr) =>
									continueUnwind(
										mws,
										ctx,
										j - 1,
										errorToResponse(resolverErr, ctx.development),
										errorResolver,
									),
							);
						}
						currentRes = resolved;
						continue;
					} catch (resolverErr) {
						currentRes = errorToResponse(resolverErr, ctx.development);
						continue;
					}
				}
				currentRes = errorToResponse(err, ctx.development);
				continue;
			}
			if (r !== undefined) {
				if (isThenable(r)) {
					return resumeUnwind(mws, ctx, r, j - 1, currentRes, errorResolver);
				}
				if (r instanceof Response) {
					currentRes = r;
				}
			}
		}
	}

	return currentRes;
}

function resumeUnwind(
	mws: readonly Middleware[],
	ctx: Context,
	promise: PromiseLike<unknown>,
	nextIndex: number,
	currentRes: Response,
	errorResolver?: ErrorResolver,
): Promise<Response> {
	return Promise.resolve(promise).then(
		(r) => {
			const next = r instanceof Response ? r : currentRes;
			return continueUnwind(mws, ctx, nextIndex, next, errorResolver);
		},
		(err: unknown) => {
			if (errorResolver !== undefined) {
				try {
					const resolved = errorResolver(err, ctx);
					if (isThenable(resolved)) {
						return (resolved as Promise<Response>).then(
							(resolvedRes) =>
								continueUnwind(mws, ctx, nextIndex, resolvedRes, errorResolver),
							(resolverErr) =>
								continueUnwind(
									mws,
									ctx,
									nextIndex,
									errorToResponse(resolverErr, ctx.development),
									errorResolver,
								),
						);
					}
					return continueUnwind(mws, ctx, nextIndex, resolved, errorResolver);
				} catch (resolverErr) {
					return continueUnwind(
						mws,
						ctx,
						nextIndex,
						errorToResponse(resolverErr, ctx.development),
						errorResolver,
					);
				}
			}
			const next = errorToResponse(err, ctx.development);
			return continueUnwind(mws, ctx, nextIndex, next, errorResolver);
		},
	);
}

function continueUnwind(
	mws: readonly Middleware[],
	ctx: Context,
	startIndex: number,
	currentRes: Response,
	errorResolver?: ErrorResolver,
): Response | Promise<Response> {
	let cur = currentRes;
	for (let j = startIndex; j >= 0; j--) {
		const hook = mws[j]!.after;
		if (hook) {
			let r: unknown;
			try {
				r = hook(ctx, cur);
			} catch (err) {
				if (errorResolver !== undefined) {
					try {
						const resolved = errorResolver(err, ctx);
						if (isThenable(resolved)) {
							return (resolved as Promise<Response>).then(
								(resolvedRes) =>
									continueUnwind(mws, ctx, j - 1, resolvedRes, errorResolver),
								(resolverErr) =>
									continueUnwind(
										mws,
										ctx,
										j - 1,
										errorToResponse(resolverErr, ctx.development),
										errorResolver,
									),
							);
						}
						cur = resolved;
						continue;
					} catch (resolverErr) {
						cur = errorToResponse(resolverErr, ctx.development);
						continue;
					}
				}
				cur = errorToResponse(err, ctx.development);
				continue;
			}
			if (r !== undefined) {
				if (isThenable(r)) {
					return resumeUnwind(mws, ctx, r, j - 1, cur, errorResolver);
				}
				if (r instanceof Response) {
					cur = r;
				}
			}
		}
	}
	return cur;
}
