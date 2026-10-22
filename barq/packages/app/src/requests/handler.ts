// Handler builder — binds a validated request to a route handler so the
// controller receives typed, already-validated input instead of calling
// `validated()` itself. Three forms:
//
//   // Contract at the route:
//   users.get("/:id", action(ShowUserRequest, userController.show));
//
//   // …or declared once on the method and wrapped by reference:
//   //   @validatedBy(ShowUserRequest)
//   //   async show(ctx, { id }) { … }
//   users.get("/:id", action(userController.show));
//
//   // …or no validation at all — `data` receives the raw `ctx.params`
//   // (a `ctx`-only method works too):
//   users.get("/:id", action(userController.rawShow));
//   //   async rawShow(ctx, { id }) { … }   // `id` as parsed, no rules
//
// In the validated forms `run` follows the framework's `(ctx, data)`
// convention — the same one controller methods use — so a method from a
// `controller()` instance can be passed as `run` directly (`controller()`
// binds methods, so `this` is safe). An inline `(ctx, data) => …` stays
// available for routes that do more than delegate.
//
// The request class is resolved through the DI container (exactly like an
// injected request), so any failure flows through the same localized 400
// (or 403 from `authorize`) as `validated()` — and the handler keeps full
// type inference for `data`.
//
// While the route is registered, the OpenAPI plugin reads the metadata
// attached below and derives `params`/`query`/`headers`/`body` from the
// request class automatically, so docs and validation can never drift.
import type { Context, Handler, HandlerResult, Params } from "@barqel/barq";
import {
	type HandlerDocs,
	type HandlerRouteMeta,
	ROUTE_META,
} from "@barqel/barq-openapi";
import { controller, type RequestData, r } from "../vendor";
import { BaseRequest } from "./base-request";
import { attachRequestClass, readRequestClass } from "./request-meta";

/** A concrete `BaseRequest` subclass (body, params, query or headers). */
export type RequestConstructor = new (...args: unknown[]) => BaseRequest;

/**
 * Declares the request class a controller method validates with, so the route
 * can wrap the bare method:
 *
 *   @singleton()
 *   class UserController {
 *     @validatedBy(ShowUserRequest)
 *     async show(ctx: Context, { id }: RequestData<ShowUserRequest>) { … }
 *   }
 *
 *   users.get("/:id", action(userController.show));
 *
 * Equivalent to passing the class explicitly at the route
 * (`action(ShowUserRequest, userController.show)`) — pick one. The method's
 * `data` parameter is type-checked against the request output.
 */
export function validatedBy<TRequest extends RequestConstructor>(
	Request: TRequest,
) {
	return <TResult extends HandlerResult>(
		_target: object,
		_key: string | symbol,
		descriptor: TypedPropertyDescriptor<
			(ctx: Context, data: RequestData<InstanceType<TRequest>>) => TResult
		>,
	): void => {
		const fn = descriptor.value;

		if (typeof fn === "function") {
			attachRequestClass(fn, Request);
		}
	};
}

/**
 * Composes a request validator with a route handler.
 *
 * `action(Request, run, docs?)` returns a Barq route handler: it validates
 * the request (`await request.validated()`), then calls `run(ctx, data)` with
 * the typed result. Validation errors are thrown before `run` is ever called.
 *
 * `run` follows the same `(ctx, data)` convention as controller methods, so
 * methods from a `controller()` instance are accepted as-is:
 * `action(ShowUserRequest, userController.show)`.
 *
 * The request class lives either in the first argument or in the method's
 * `@validatedBy(Request)` stamp — `action(userController.show)` reads it
 * from there.
 *
 * With neither, the route runs without validation: `data` receives the raw
 * `ctx.params` (no rules, no coercion), and a `ctx`-only `run` simply
 * ignores it. Type that parameter as a plain shape or `RouteParams<…>` —
 * `RequestData<…>` would advertise validation that never ran. The operation
 * still registers (path params and the default response); `docs` adds the
 * rest.
 *
 * The optional `docs` adds OpenAPI operation metadata (tags, summary,
 * responses, …); the request schema itself is derived from the request class
 * and registered with the docs registry automatically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ControllerConstructor<T = object> = new (...args: any[]) => T;

export type ControllerMethodNames<T> = {
	[K in keyof T]: T[K] extends (...args: never[]) => unknown ? K : never;
}[keyof T] &
	string;

export type ControllerActionTuple<
	T = object,
	M extends ControllerMethodNames<T> = ControllerMethodNames<T>,
> = [target: ControllerConstructor<T>, method: M];

// Cache resolved controller instances per constructor
const controllerInstanceCache = new Map<
	ControllerConstructor<unknown>,
	unknown
>();

function resolveControllerInstance<T extends object>(
	Target: ControllerConstructor<T>,
): T {
	let instance = controllerInstanceCache.get(
		Target as ControllerConstructor<unknown>,
	);
	if (!instance) {
		instance = controller(
			Target as unknown as import("tsyringe").InjectionToken<T>,
		);
		controllerInstanceCache.set(
			Target as ControllerConstructor<unknown>,
			instance,
		);
	}
	return instance as T;
}

function resolveRunFunction(
	target: unknown,
): (ctx: Context, data: unknown) => HandlerResult | Promise<HandlerResult> {
	if (
		Array.isArray(target) &&
		target.length === 2 &&
		typeof target[0] === "function"
	) {
		const [ControllerClass, methodName] = target as [
			ControllerConstructor<Record<string, (...args: unknown[]) => unknown>>,
			string,
		];
		const instance = resolveControllerInstance(ControllerClass);
		const method = instance[methodName];
		if (typeof method !== "function") {
			throw new Error(
				`Method "${methodName}" not found on controller "${ControllerClass.name}".`,
			);
		}
		const bound = method.bind(instance);
		// Also inherit any @validatedBy stamp from original prototype method
		const originalMethod = ControllerClass.prototype?.[methodName];
		if (originalMethod) {
			const req = readRequestClass(originalMethod);
			if (req) {
				attachRequestClass(bound, req);
			}
		}
		return bound as (
			ctx: Context,
			data: unknown,
		) => HandlerResult | Promise<HandlerResult>;
	}

	return target as (
		ctx: Context,
		data: unknown,
	) => HandlerResult | Promise<HandlerResult>;
}

export function action<
	TRequest extends RequestConstructor,
	TResult extends HandlerResult,
	TParams extends object = Params,
	TState extends object = Record<string, unknown>,
>(
	Request: TRequest,
	run: (
		ctx: Context<TParams, TState>,
		data: RequestData<InstanceType<TRequest>>,
	) => TResult | Promise<TResult>,
	docs?: HandlerDocs,
): Handler<TParams, TState>;

export function action<
	TRequest extends RequestConstructor,
	TController extends object,
	TMethod extends ControllerMethodNames<TController>,
	TParams extends object = Params,
	TState extends object = Record<string, unknown>,
>(
	Request: TRequest,
	target: [target: ControllerConstructor<TController>, method: TMethod],
	docs?: HandlerDocs,
): Handler<TParams, TState>;

export function action<
	TController extends object,
	TMethod extends ControllerMethodNames<TController>,
	TParams extends object = Params,
	TState extends object = Record<string, unknown>,
>(
	target: [target: ControllerConstructor<TController>, method: TMethod],
	docs?: HandlerDocs,
): Handler<TParams, TState>;

export function action<
	TData,
	TResult extends HandlerResult,
	TParams extends object = Params,
	TState extends object = Record<string, unknown>,
>(
	run: (
		ctx: Context<TParams, TState>,
		data: TData,
	) => TResult | Promise<TResult>,
	docs?: HandlerDocs,
): Handler<TParams, TState>;

export function action(
	first:
		| RequestConstructor
		| [ControllerConstructor<object>, string]
		| ((ctx: Context, data: never) => HandlerResult | Promise<HandlerResult>),
	second?:
		| [ControllerConstructor<object>, string]
		| ((ctx: Context, data: never) => HandlerResult | Promise<HandlerResult>)
		| HandlerDocs,
	third?: HandlerDocs,
): Handler {
	// A request class is the only first argument with `BaseRequest` in its
	// prototype chain — anything else is the run function (or tuple) itself.
	const explicit =
		typeof first === "function" && first.prototype instanceof BaseRequest;

	const runCandidate = resolveRunFunction(explicit ? second : first);

	const Request = (explicit ? first : readRequestClass(runCandidate)) as
		| RequestConstructor
		| undefined;

	if (!Request) {
		if (typeof runCandidate !== "function") {
			throw new Error(
				"action(...) expects a request class or a route run function/controller tuple.",
			);
		}

		if ((runCandidate as unknown as Record<PropertyKey, unknown>)[ROUTE_META]) {
			// Already wrapped by `action` — nothing to add.
			return runCandidate as unknown as Handler;
		}

		// No request class: the route runs without validation — `data` is the
		// raw `ctx.params` (no rules, no coercion); a `ctx`-only `run` simply
		// ignores it.
		const run = runCandidate as (
			ctx: Context,
			data: Params,
		) => HandlerResult | Promise<HandlerResult>;

		const docs = (explicit ? third : second) as HandlerDocs | undefined;

		const bare = ((ctx: Context) => run(ctx, ctx.params)) as Handler;

		// No request schema to derive, but the operation still registers:
		// path params and the default response come from the route pattern;
		// `docs` adds the rest.
		(bare as unknown as Record<PropertyKey, unknown>)[ROUTE_META] = {
			docs,
		} satisfies HandlerRouteMeta;

		return bare;
	}

	const run = runCandidate;
	const docs = (explicit ? third : second) as HandlerDocs | undefined;

	// Cast restores the concrete instance type erased by the generic
	// constructor constraint, so `validated()` infers the exact output.
	// No `ctx` argument: `validated()` resolves the request scope itself
	// (the same `ctx` reachable here), keeping its parameter typing intact.
	const request = controller(Request);

	const handler = async (ctx: Context): Promise<HandlerResult> =>
		run(ctx, await request.validated());

	// Route metadata consumed by @barqel/barq-openapi at registration time.
	(handler as unknown as Record<PropertyKey, unknown>)[ROUTE_META] = {
		source: request.source(),
		schema: r.object(request.rules()),
		docs,
	} satisfies HandlerRouteMeta;

	return handler as Handler;
}
