// biome-ignore-all lint/suspicious/noThenProperty: These fixtures verify duck-typed thenables.
import { describe, expect, it } from "bun:test";
import { Context, type ContextApplication } from "../src/context";
import {
	composeMiddlewareDispatcher,
	composeMiddlewares,
	isThenable,
	runPipeline,
} from "../src/middleware";
import type { Middleware } from "../src/types";

const createReq = (url: string, headers: Record<string, string> = {}) => {
	const h = new Headers(headers);
	return new Request(url, { headers: h });
};

const contextApplication: ContextApplication = {
	development: false,
	redirectHosts: new Set(),
	trustProxy: false,
	cookieSecret: "secret",
};

const createCtx = () => {
	return new Context(
		createReq("http://example.com/"),
		null,
		{},
		contextApplication,
	);
};

describe("Middleware Pipeline", () => {
	it("runs a compiled synchronous before chain in order", async () => {
		const order: number[] = [];
		const middleware: Middleware[] = [
			{
				before: () => {
					order.push(1);
				},
			},
			{
				before: () => {
					order.push(2);
				},
			},
		];
		const handler = () => {
			order.push(3);
			return new Response("ok");
		};
		const run = composeMiddlewares(middleware, handler);

		const response = await run(createCtx());
		expect(await response.text()).toBe("ok");
		expect(order).toEqual([1, 2, 3]);
	});

	it("keeps thenable and error-resolver behavior in compiled chains", async () => {
		const ctx = createCtx();
		const thenable = {
			then: (resolve: (value: unknown) => void) => resolve(undefined),
		};
		const dispatcher = composeMiddlewareDispatcher([
			{ before: () => ({ traceId: "trace-compiled" }) },
			{ before: () => thenable as unknown as undefined },
		]);
		const response = await dispatcher(
			ctx,
			(requestContext) => new Response(String(requestContext.state.traceId)),
		);
		expect(await response.text()).toBe("trace-compiled");

		const rejects = composeMiddlewares(
			[{ before: () => Promise.reject(new Error("compiled failure")) }],
			() => new Response("unreachable"),
			(error) => new Response(String(error), { status: 500 }),
		);
		const failure = await rejects(createCtx());
		expect(failure.status).toBe(500);
		expect(await failure.text()).toContain("compiled failure");
	});

	it("uses the established pipeline when after hooks are present", async () => {
		const order: number[] = [];
		const run = composeMiddlewares(
			[
				{
					before: () => {
						order.push(1);
					},
					after: (_ctx, response) => {
						order.push(3);
						return response;
					},
				},
				{
					before: () => {
						order.push(2);
					},
				},
			],
			() => {
				order.push(4);
				return new Response("ok");
			},
		);

		await run(createCtx());
		expect(order).toEqual([1, 2, 4, 3]);
	});

	it("recognizes native promises and preserves generic thenable behavior", () => {
		expect(isThenable(Promise.resolve())).toBe(true);
		expect(isThenable({ then: () => undefined })).toBe(true);
		expect(
			isThenable(Object.assign(() => undefined, { then: () => undefined })),
		).toBe(true);
		expect(isThenable({ then: null })).toBe(false);
		expect(isThenable(null)).toBe(false);
		expect(isThenable(42)).toBe(false);

		const overriddenPromise = Promise.resolve();
		Object.defineProperty(overriddenPromise, "then", { value: undefined });
		expect(isThenable(overriddenPromise)).toBe(false);
	});

	it("merges object results from before hooks into request state", async () => {
		const ctx = createCtx();
		const response = await runPipeline(
			[{ before: () => ({ traceId: "trace-123" }) }],
			ctx,
			(requestContext) => new Response(String(requestContext.state.traceId)),
		);

		expect(await response.text()).toBe("trace-123");
		expect(ctx.state.traceId).toBe("trace-123");
	});

	it("merges async before results before invoking the route handler", async () => {
		const ctx = createCtx();
		const response = await runPipeline(
			[{ before: async () => ({ principal: "user-7" }) }],
			ctx,
			(requestContext) => new Response(String(requestContext.state.principal)),
		);

		expect(await response.text()).toBe("user-7");
	});

	it("should run before hooks in order", async () => {
		const order: number[] = [];
		const middlewares = [
			{
				before: (_ctx: Context) => {
					order.push(1);
				},
			},
			{
				before: (_ctx: Context) => {
					order.push(2);
				},
			},
		];
		const handler = (_ctx: Context) => {
			order.push(3);
			return new Response("ok");
		};

		await runPipeline(middlewares, createCtx(), handler);
		expect(order).toEqual([1, 2, 3]);
	});

	it("should run after hooks in reverse order", async () => {
		const order: number[] = [];
		const middlewares = [
			{
				after: (_ctx: Context, res: Response) => {
					order.push(1);
					return res;
				},
			},
			{
				after: (_ctx: Context, res: Response) => {
					order.push(2);
					return res;
				},
			},
		];
		const handler = (_ctx: Context) => {
			order.push(3);
			return new Response("ok");
		};

		await runPipeline(middlewares, createCtx(), handler);
		expect(order).toEqual([3, 2, 1]);
	});

	it("should short-circuit on before returning Response", async () => {
		const order: number[] = [];
		const middlewares = [
			{
				before: (_ctx: Context) => {
					order.push(1);
					return new Response("early");
				},
			},
			{
				before: (_ctx: Context) => {
					order.push(2);
				},
			},
			// This after hook should NOT run because its before was never called
			{
				after: (_ctx: Context, res: Response) => {
					order.push(3);
					return res;
				},
			},
		];
		const handler = (_ctx: Context) => {
			order.push(4);
			return new Response("ok");
		};

		await runPipeline(middlewares, createCtx(), handler);
		// Only the first before hook runs, no after hooks run because the first middleware has no after hook
		expect(order).toEqual([1]);
	});

	it("should short-circuit on before returning Promise<Response>", async () => {
		const order: number[] = [];
		const middlewares = [
			{
				before: (_ctx: Context) => {
					order.push(1);
					return Promise.resolve(new Response("early"));
				},
			},
			{
				before: (_ctx: Context) => {
					order.push(2);
				},
			},
			{
				after: (_ctx: Context, res: Response) => {
					order.push(3);
					return res;
				},
			},
		];
		const handler = (_ctx: Context) => {
			order.push(4);
			return new Response("ok");
		};

		await runPipeline(middlewares, createCtx(), handler);
		expect(order).toEqual([1]);
	});

	it("should run after hook of the middleware that returned Response", async () => {
		const order: number[] = [];
		const middlewares = [
			{
				before: (_ctx: Context) => {
					order.push(1);
					return new Response("early");
				},
				after: (_ctx: Context, res: Response) => {
					order.push(2);
					return res;
				},
			},
			{
				before: (_ctx: Context) => {
					order.push(3);
				},
			},
		];
		const handler = (_ctx: Context) => {
			order.push(4);
			return new Response("ok");
		};

		await runPipeline(middlewares, createCtx(), handler);
		// First middleware's before and after should run
		expect(order).toEqual([1, 2]);
	});

	it("should catch synchronous errors in before hooks", async () => {
		const middlewares = [
			{
				before: () => {
					throw new Error("sync error");
				},
			},
			{ before: () => {} },
		];
		const handler = () => new Response("ok");

		const res = await runPipeline(
			middlewares,
			createCtx(),
			handler,
			(err) =>
				new Response(
					`caught: ${err instanceof Error ? err.message : String(err)}`,
					{
						status: 500,
					},
				),
		);
		expect(res.status).toBe(500);
		expect(await res.text()).toContain("sync error");
	});

	it("should catch asynchronous errors in before hooks", async () => {
		const middlewares = [
			{ before: () => Promise.reject(new Error("async error")) },
		];
		const handler = () => new Response("ok");

		const res = await runPipeline(
			middlewares,
			createCtx(),
			handler,
			(err) =>
				new Response(
					`caught: ${err instanceof Error ? err.message : String(err)}`,
					{
						status: 500,
					},
				),
		);
		expect(res.status).toBe(500);
		expect(await res.text()).toContain("async error");
	});

	it("should catch errors in handler", async () => {
		const middlewares: Middleware[] = [];
		const handler = () => {
			throw new Error("handler error");
		};

		const res = await runPipeline(
			middlewares,
			createCtx(),
			handler,
			(err) =>
				new Response(
					`caught: ${err instanceof Error ? err.message : String(err)}`,
					{
						status: 500,
					},
				),
		);
		expect(res.status).toBe(500);
		expect(await res.text()).toContain("handler error");
	});

	it("should catch errors in async handler", async () => {
		const middlewares: Middleware[] = [];
		const handler = () => Promise.reject(new Error("async handler error"));

		const res = await runPipeline(
			middlewares,
			createCtx(),
			handler,
			(err) =>
				new Response(
					`caught: ${err instanceof Error ? err.message : String(err)}`,
					{
						status: 500,
					},
				),
		);
		expect(res.status).toBe(500);
		expect(await res.text()).toContain("async handler error");
	});

	it("should run after hooks on error response from resolver", async () => {
		const order: number[] = [];
		const middlewares = [
			{
				after: (_ctx: Context, res: Response) => {
					order.push(1);
					return res;
				},
			},
		];
		const handler = () => {
			throw new Error("error");
		};

		await runPipeline(
			middlewares,
			createCtx(),
			handler,
			(_err) => new Response("error response", { status: 500 }),
		);
		expect(order).toEqual([1]);
	});

	it("should track entered count correctly for after hooks", async () => {
		const enteredCounts: number[] = [];
		const middlewares = [
			{
				before: (_ctx: Context) => {},
				after: (_ctx: Context, res: Response) => {
					enteredCounts.push(1);
					return res;
				},
			},
			{
				before: (_ctx: Context) => {},
				after: (_ctx: Context, res: Response) => {
					enteredCounts.push(2);
					return res;
				},
			},
		];
		const handler = () => new Response("ok");

		await runPipeline(middlewares, createCtx(), handler);
		expect(enteredCounts).toEqual([2, 1]);
	});

	it("should handle errorResolver throwing", async () => {
		const middlewares: Middleware[] = [];
		const handler = () => {
			throw new Error("original");
		};

		const res = await runPipeline(middlewares, createCtx(), handler, () => {
			throw new Error("resolver error");
		});
		expect(res.status).toBe(500);
		// When resolver throws, it goes through errorToResponse which returns a generic error
		expect(await res.text()).toContain("Internal Server Error");
	});

	it("should handle async errorResolver", async () => {
		const middlewares: Middleware[] = [];
		const handler = () => {
			throw new Error("original");
		};

		const res = await runPipeline(middlewares, createCtx(), handler, () =>
			Promise.resolve(new Response("resolved", { status: 500 })),
		);
		expect(res.status).toBe(500);
		expect(await res.text()).toBe("resolved");
	});

	it("should handle errorResolver returning Promise that rejects", async () => {
		const middlewares: Middleware[] = [];
		const handler = () => {
			throw new Error("original");
		};

		const res = await runPipeline(middlewares, createCtx(), handler, () =>
			Promise.reject(new Error("resolver rejected")),
		);
		expect(res.status).toBe(500);
		// When resolver rejects, it goes through errorToResponse which returns a generic error
		expect(await res.text()).toContain("Internal Server Error");
	});

	it("should handle after hook returning Response", async () => {
		const middlewares = [
			{ after: (_ctx: Context, _res: Response) => new Response("modified") },
		];
		const handler = () => new Response("original");

		const res = await runPipeline(middlewares, createCtx(), handler);
		expect(await res.text()).toBe("modified");
	});

	it("should handle after hook returning Promise<Response>", async () => {
		const middlewares = [
			{
				after: (_ctx: Context, _res: Response) =>
					Promise.resolve(new Response("modified")),
			},
		];
		const handler = () => new Response("original");

		const res = await runPipeline(middlewares, createCtx(), handler);
		expect(await res.text()).toBe("modified");
	});
});
