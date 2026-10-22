import { cpus } from "node:os";
import type { ServeOptions, Server, ServerWebSocket } from "bun";
import { Context, type ContextApplication } from "./context";
import { applyPendingCookies } from "./cookies";
import { errorToResponse, HttpError } from "./errors";
import { compileTrustProxy, isIpRange } from "./internal/ip";
import { scanPathname } from "./internal/pathname";
import { findQueryParam, findQueryParamAll } from "./internal/query";
import {
	analyzeHandler,
	type HandlerAnalysis,
	type HandlerFunction,
} from "./internal/scan";
import type { ShutdownResult } from "./internal/shutdown";
import { stopServer } from "./internal/shutdown";
import type { RouteParams as TrieParams } from "./internal/trie";
import { MATCH_HANDLER, MATCH_NOT_ALLOWED, SegmentTrie } from "./internal/trie";
import {
	composeMiddlewareDispatcher,
	composeMiddlewares,
	isThenable,
	type MiddlewareDispatcher,
	unwindAfter,
} from "./middleware";
import type {
	ErrorHandler,
	ErrorResolver,
	Handler,
	HandlerResult,
	HttpMethod,
	JoinPath,
	Middleware,
	NotFoundHandler,
	Params,
	ResponseHandler,
	RouteParams,
	WebSocketHandlers,
} from "./types";

export type { ShutdownResult };

const METHODS: readonly HttpMethod[] = [
	"GET",
	"POST",
	"PUT",
	"DELETE",
	"PATCH",
	"HEAD",
	"OPTIONS",
];
const MAX_ROUTE_SEGMENTS = 256;
const EMPTY_PARAMS: Params = Object.freeze(Object.create(null) as Params);

const FAST_JSON_HEADERS: Headers = new Headers({
	"content-type": "application/json; charset=utf-8",
});
const FAST_TEXT_HEADERS: Headers = new Headers({
	"content-type": "text/plain; charset=utf-8",
});

class ReadonlySetView<T> {
	constructor(private readonly source: Set<T>) {}
	get size(): number {
		return this.source.size;
	}
	has(value: T): boolean {
		return this.source.has(value);
	}
	forEach(
		callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
		thisArg?: unknown,
	): void {
		this.source.forEach((value) => {
			callback.call(thisArg, value, value, this as unknown as ReadonlySet<T>);
		});
	}
	entries(): IterableIterator<[T, T]> {
		return this.source.entries();
	}
	keys(): IterableIterator<T> {
		return this.source.keys();
	}
	values(): IterableIterator<T> {
		return this.source.values();
	}
	[Symbol.iterator](): IterableIterator<T> {
		return this.source[Symbol.iterator]();
	}
	get [Symbol.toStringTag](): string {
		return "Set";
	}
}

function createReadonlySet<T>(source: Set<T>): ReadonlySet<T> {
	return new ReadonlySetView(source) as unknown as ReadonlySet<T>;
}

const EMPTY_REDIRECT_HOSTS: ReadonlySet<string> = createReadonlySet(
	new Set<string>(),
);

interface HandlerNeeds {
	isContextFree: boolean;
	isLightweight: boolean;
	isParamsOnly: boolean;
	isJsonBodyOnly: boolean;
}

function expandOptionalPatterns(pattern: string): string[] {
	if (!pattern.includes("?")) return [pattern];
	const segments = pattern.split("/").filter(Boolean);
	const optIndices: number[] = [];
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;
		if (seg.startsWith(":") && seg.endsWith("?")) {
			optIndices.push(i);
		}
	}
	if (optIndices.length === 0) return [pattern];

	const variants: string[] = [];
	const count = 1 << optIndices.length;
	for (let mask = 0; mask < count; mask++) {
		const parts: string[] = [];
		for (let i = 0; i < segments.length; i++) {
			const optPos = optIndices.indexOf(i);
			if (optPos >= 0) {
				if (mask & (1 << optPos)) {
					parts.push(segments[i]!.slice(0, -1));
				}
			} else {
				parts.push(segments[i]!);
			}
		}
		variants.push(parts.length === 0 ? "/" : `/${parts.join("/")}`);
	}
	return variants;
}

const LIGHT_SUPPORTED_PROPS = new Set([
	"req",
	"params",
	"pathname",
	"queryParam",
	"queryParamAll",
	"state",
	"stream",
	"bodyStream",
]);

function classifyProps(props: Set<string>): HandlerNeeds {
	for (const p of props) {
		if (!LIGHT_SUPPORTED_PROPS.has(p)) {
			return {
				isContextFree: false,
				isLightweight: false,
				isParamsOnly: false,
				isJsonBodyOnly: false,
			};
		}
	}

	const hasParams = props.has("params") || props.size === 0;
	const hasQuery = props.has("queryParam") || props.has("queryParamAll");

	if (hasParams && props.size === 1) {
		return {
			isContextFree: false,
			isLightweight: true,
			isParamsOnly: true,
			isJsonBodyOnly: false,
		};
	}

	if (hasParams || hasQuery || props.size > 0) {
		return {
			isContextFree: false,
			isLightweight: true,
			isParamsOnly: false,
			isJsonBodyOnly: false,
		};
	}

	return {
		isContextFree: false,
		isLightweight: false,
		isParamsOnly: false,
		isJsonBodyOnly: false,
	};
}

function classify(analysis: HandlerAnalysis): HandlerNeeds {
	if (analysis.isNoArg) {
		return {
			isContextFree: true,
			isLightweight: false,
			isParamsOnly: false,
			isJsonBodyOnly: false,
		};
	}
	if (
		analysis.arglessJsonCall &&
		!analysis.isDestructured &&
		analysis.contextProps.size === 1 &&
		analysis.contextProps.has("json")
	) {
		return {
			isContextFree: false,
			isLightweight: false,
			isParamsOnly: false,
			isJsonBodyOnly: true,
		};
	}
	if (analysis.isDestructured) {
		return classifyProps(analysis.destructuredProps);
	}
	if (analysis.hasDynamicAccess) {
		return {
			isContextFree: false,
			isLightweight: false,
			isParamsOnly: false,
			isJsonBodyOnly: false,
		};
	}
	return classifyProps(analysis.contextProps);
}

function detectHandlerNeeds(fn: HandlerFunction): HandlerNeeds {
	try {
		return classify(analyzeHandler(fn));
	} catch {
		return {
			isContextFree: false,
			isLightweight: false,
			isParamsOnly: false,
			isJsonBodyOnly: false,
		};
	}
}

class FastLightContext {
	_pathname?: string;
	_state?: Record<string, unknown>;
	_hasPendingCookies = false;
	private _url?: string;
	private _qPos = -2;

	constructor(
		public req: Request,
		public params: Record<string, string>,
	) {}

	init(req: Request, params: Record<string, string>): this {
		this.req = req;
		this.params = params;
		this._pathname = undefined;
		this._state = undefined;
		this._hasPendingCookies = false;
		this._url = undefined;
		this._qPos = -2;
		return this;
	}

	get url(): string {
		if (this._url === undefined) {
			this._url = this.req.url;
		}
		return this._url;
	}
	get pathname(): string {
		if (this._pathname === undefined) {
			this._pathname = scanPathname(this.url);
		}
		return this._pathname;
	}
	queryParam(name: string): string | null {
		let u = this._url;
		if (u === undefined) {
			u = this.req.url;
			this._url = u;
		}
		let q = this._qPos;
		if (q === -2) this._qPos = q = u.indexOf("?");
		return findQueryParam(u, name, q);
	}
	queryParamAll(name: string): string[] {
		return findQueryParamAll(this.url, name);
	}
	get cookies(): never {
		throw new Error("LightweightContext does not support cookies.");
	}
	get state(): Record<string, unknown> {
		let state = this._state;
		if (state === undefined) {
			state = Object.create(null) as Record<string, unknown>;
			this._state = state;
		}
		return state;
	}
	stream(): ReadableStream<Uint8Array> | null {
		return this.req.body;
	}
	get bodyStream(): ReadableStream<Uint8Array> | null {
		return this.req.body;
	}
}

const lightContextPool: FastLightContext[] = [];

function acquireLightContext(
	req: Request,
	params: Record<string, string>,
): FastLightContext {
	const popped = lightContextPool.pop();
	if (popped !== undefined) {
		return popped.init(req, params);
	}
	return new FastLightContext(req, params);
}

function releaseLightContext(ctx: FastLightContext): void {
	if (lightContextPool.length < 128) {
		lightContextPool.push(ctx);
	}
}

export type RouteHandlerArg = Middleware | readonly Middleware[];

type MiddlewareOutput<TMiddleware> = TMiddleware extends {
	before?: (...args: never[]) => infer TResult;
}
	? Exclude<
			Awaited<TResult>,
			Response | void | undefined
		> extends infer TOutput extends object
		? TOutput
		: never
	: never;

type UnionToIntersection<T> = (
	T extends unknown
		? (value: T) => void
		: never
) extends (value: infer TIntersection) => void
	? TIntersection
	: never;

type MiddlewareOutputs<TMiddlewares extends readonly unknown[]> =
	UnionToIntersection<MiddlewareOutput<TMiddlewares[number]>>;

export interface WebSocketOptions {
	maxPayloadLength?: number;
	backpressureLimit?: number;
	closeOnBackpressureLimit?: boolean;
	idleTimeout?: number;
	open?: (ws: ServerWebSocket<unknown>) => void | Promise<void>;
	message?: (
		ws: ServerWebSocket<unknown>,
		message: string | Buffer,
	) => void | Promise<void>;
	close?: (
		ws: ServerWebSocket<unknown>,
		code: number,
		reason: string,
	) => void | Promise<void>;
	drain?: (ws: ServerWebSocket<unknown>) => void | Promise<void>;
	error?: (
		ws: ServerWebSocket<unknown>,
		error: unknown,
	) => void | Promise<void>;
}

type WebSocketCallback = (...args: never[]) => unknown;

function reportWebSocketError(
	handler: WebSocketHandlers["error"] | undefined,
	ws: ServerWebSocket<unknown>,
	error: unknown,
): void {
	if (!handler) {
		console.error("Unhandled WebSocket callback error:", error);
		return;
	}
	try {
		const result = handler(ws, error);
		if (isThenable(result)) {
			Promise.resolve(result).catch((handlerError) =>
				console.error("WebSocket error handler failed:", handlerError),
			);
		}
	} catch (handlerError) {
		console.error("WebSocket error handler failed:", handlerError);
	}
}

function dispatchWebSocketCallback(
	callback: WebSocketCallback | undefined,
	args: unknown[],
	onError: (error: unknown) => void,
): void {
	if (!callback) return;
	try {
		const len = args.length;
		let result: unknown;
		if (len === 1) {
			result = (callback as (a: unknown) => unknown)(args[0]);
		} else if (len === 2) {
			result = (callback as (a: unknown, b: unknown) => unknown)(
				args[0],
				args[1],
			);
		} else if (len === 3) {
			result = (callback as (a: unknown, b: unknown, c: unknown) => unknown)(
				args[0],
				args[1],
				args[2],
			);
		} else {
			result = Reflect.apply(callback, undefined, args);
		}

		if (isThenable(result)) {
			Promise.resolve(result).catch(onError);
		}
	} catch (error) {
		onError(error);
	}
}

function getInternalWebSocketHandlers(
	ws: ServerWebSocket<unknown>,
): WebSocketHandlers | undefined {
	const data = ws.data as
		| { handlers?: WebSocketHandlers; _barqInternal?: boolean }
		| undefined;
	return data?._barqInternal === true ? data.handlers : undefined;
}

export interface AppOptions {
	port?: number;
	hostname?: string;
	development?: boolean;
	maxRequestBodySize?: number;
	idleTimeout?: number;
	tls?: ServeOptions["tls"];
	allowedRedirectHosts?: string[];
	trustProxy?: boolean | string | readonly string[] | ((ip: string) => boolean);
	websocket?: WebSocketOptions;
	cookieSecret?: string;
}

function parseRouteArgs(args: unknown[]): {
	middlewares: Middleware[];
	handler: Handler<object>;
} {
	if (args.length === 0) {
		throw new Error("Route requires a handler function");
	}
	const last = args[args.length - 1];
	if (typeof last !== "function") {
		throw new Error(
			"The final argument in route definition must be a Handler function",
		);
	}
	const handler = last as Handler<object>;
	if (args.length === 1) {
		return { middlewares: [], handler };
	}
	const middlewares: Middleware[] = [];
	for (let i = 0; i < args.length - 1; i++) {
		const item = args[i];
		if (Array.isArray(item)) {
			for (let j = 0; j < item.length; j++) {
				middlewares.push(item[j] as Middleware);
			}
		} else if (item && typeof item === "object") {
			middlewares.push(item as Middleware);
		} else {
			throw new TypeError(
				"Route middleware must be a Middleware object or array of Middleware",
			);
		}
	}
	return { middlewares, handler };
}

function normalizePrefix(prefix: string): string {
	let p = prefix.trim();
	if (p.length === 0 || p === "/") return "";
	if (p.charCodeAt(0) !== 47) p = `/${p}`;
	if (p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1);
	return p;
}

function joinPrefix(prefix: string, pattern: string): string {
	if (!prefix) return pattern;
	let p = pattern.trim();
	if (p.length === 0 || p === "/") return prefix;
	if (p.charCodeAt(0) !== 47) p = `/${p}`;
	return prefix + p;
}

function canonicalizeRoutePattern(pattern: string): string {
	let p = pattern.trim();
	if (p.length === 0) p = "/";
	if (p.charCodeAt(0) !== 47) p = `/${p}`;
	if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) {
		p = p.slice(0, -1);
	}
	return p;
}

function validateRoutePattern(pattern: string): void {
	if (pattern.length === 0 || pattern.charCodeAt(0) !== 47) {
		throw new Error(`Invalid route pattern "${pattern}": must start with /`);
	}
	if (pattern === "/") return;
	if (pattern.indexOf("#") !== -1) {
		throw new Error(`Invalid route pattern "${pattern}": must not contain #`);
	}
	const segments = pattern.split("/");
	if (segments.length - 1 > MAX_ROUTE_SEGMENTS) {
		throw new RangeError(
			`Route pattern exceeds the limit of ${MAX_ROUTE_SEGMENTS} segments`,
		);
	}
	for (let i = 1; i < segments.length; i++) {
		const seg = segments[i]!;
		if (seg.length === 0) {
			throw new Error(`Invalid route pattern "${pattern}": empty segment (//)`);
		}
		const decoded = decodeSegment(seg);
		if (decoded === "." || decoded === "..") {
			throw new Error(
				`Invalid route pattern "${pattern}": dot segments ., .. not allowed in route patterns`,
			);
		}
	}
}

function decodeSegment(seg: string): string {
	if (seg.indexOf("%") === -1) return seg;
	try {
		return decodeURIComponent(seg);
	} catch {
		return seg;
	}
}

function toResponse(
	value: HandlerResult | PromiseLike<HandlerResult>,
): Response | Promise<Response> {
	if (value instanceof Response) return value;
	if (isThenable(value)) {
		return Promise.resolve(value).then((resolved) =>
			toResponse(resolved as HandlerResult),
		);
	}
	return finalizeValue(value as HandlerResult);
}

function finalizeValue(value: HandlerResult): Response {
	if (typeof value === "object" && value !== null)
		return new Response(JSON.stringify(value), { headers: FAST_JSON_HEADERS });
	if (typeof value === "string")
		return new Response(value, { headers: FAST_TEXT_HEADERS });
	return new Response(String(value), { headers: FAST_TEXT_HEADERS });
}

async function stopClusterProcesses(
	processes: readonly ReturnType<typeof Bun.spawn>[],
	hardTimeoutMs: number,
): Promise<boolean> {
	const running = processes.filter((process) => !process.killed);
	if (running.length === 0) return false;
	for (const process of running) process.kill("SIGTERM");

	const exited = Promise.all(running.map((process) => process.exited));
	let timer: ReturnType<typeof setTimeout> | undefined;
	const forced = await Promise.race([
		exited.then(() => false),
		new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(true), hardTimeoutMs);
			timer.unref?.();
		}),
	]);
	if (timer !== undefined) clearTimeout(timer);
	if (forced) {
		for (const process of running) {
			if (!process.killed) process.kill("SIGKILL");
		}
		await exited;
	}
	return forced;
}

export class RouteGroup<
	Prefix extends string = string,
	TState extends object = Record<string, unknown>,
> {
	constructor(
		private readonly app: App<TState>,
		readonly prefix: string,
		private readonly middlewares: Middleware[] = [],
	) {}

	use<const TMiddlewares extends readonly Middleware<TState, object>[]>(
		...middlewares: TMiddlewares
	): RouteGroup<Prefix, TState & MiddlewareOutputs<TMiddlewares>> {
		for (let i = 0; i < middlewares.length; i++) {
			this.middlewares.push(middlewares[i]! as Middleware);
		}
		return this as unknown as RouteGroup<
			Prefix,
			TState & MiddlewareOutputs<TMiddlewares>
		>;
	}

	plugin<TOptions>(
		pluginFn: (group: this, options?: TOptions) => void,
		options?: TOptions,
	): this {
		pluginFn(this, options);
		return this;
	}

	private _register(
		method: HttpMethod,
		pattern: string,
		args: unknown[],
	): this {
		return this._registerMethods([method], pattern, args);
	}

	private _registerMethods(
		methods: readonly HttpMethod[],
		pattern: string,
		args: unknown[],
	): this {
		const fullPattern = joinPrefix(this.prefix, pattern);
		const { middlewares, handler } = parseRouteArgs(args);
		const allMiddlewares =
			this.middlewares.length === 0
				? middlewares
				: [...this.middlewares, ...middlewares];
		this.app._registerMethods(
			methods,
			fullPattern,
			allMiddlewares.length === 0 ? [handler] : [...allMiddlewares, handler],
		);
		return this;
	}

	add<P extends string>(
		method: HttpMethod,
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	add<P extends string>(
		method: HttpMethod,
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	add(method: HttpMethod, pattern: string, ...args: unknown[]): this {
		return this._register(method, pattern, args);
	}

	get<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	get<P extends string>(
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	get(pattern: string, ...args: unknown[]): this {
		return this._register("GET", pattern, args);
	}

	post<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	post<P extends string>(
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	post(pattern: string, ...args: unknown[]): this {
		return this._register("POST", pattern, args);
	}

	put<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	put<P extends string>(
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	put(pattern: string, ...args: unknown[]): this {
		return this._register("PUT", pattern, args);
	}

	delete<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	delete<P extends string>(
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	delete(pattern: string, ...args: unknown[]): this {
		return this._register("DELETE", pattern, args);
	}

	patch<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	patch<P extends string>(
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	patch(pattern: string, ...args: unknown[]): this {
		return this._register("PATCH", pattern, args);
	}

	head<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	head<P extends string>(
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	head(pattern: string, ...args: unknown[]): this {
		return this._register("HEAD", pattern, args);
	}

	options<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	options<P extends string>(
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	options(pattern: string, ...args: unknown[]): this {
		return this._register("OPTIONS", pattern, args);
	}

	all<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
	): this;
	all<P extends string>(
		pattern: P,
		...handlers: [
			...RouteHandlerArg[],
			Handler<RouteParams<JoinPath<Prefix, P>>, TState>,
		]
	): this;
	all(pattern: string, ...args: unknown[]): this {
		return this._registerMethods(METHODS, pattern, args);
	}

	ws<P extends string, TData = unknown>(
		pattern: P,
		handlers: WebSocketHandlers<TData>,
		beforeUpgrade?: (
			ctx: Context<RouteParams<JoinPath<Prefix, P>>, TState>,
		) => boolean | { data?: TData } | Promise<boolean | { data?: TData }>,
	): this {
		this.app.ws(
			joinPrefix(this.prefix, pattern),
			handlers,
			beforeUpgrade
				? (ctx) =>
						beforeUpgrade(
							ctx as unknown as Context<
								RouteParams<JoinPath<Prefix, P>>,
								TState
							>,
						)
				: undefined,
		);
		return this;
	}

	group<Sub extends string>(
		prefix: Sub,
		callback: (group: RouteGroup<JoinPath<Prefix, Sub>, TState>) => void,
	): this;
	group<Sub extends string>(
		prefix: Sub,
		...args: [
			...RouteHandlerArg[],
			(group: RouteGroup<JoinPath<Prefix, Sub>, TState>) => void,
		]
	): this;
	group(prefix: string, ...args: unknown[]): this {
		const nestedPrefix = joinPrefix(this.prefix, prefix);
		const last = args[args.length - 1];
		if (typeof last !== "function") {
			throw new Error("Route group callback must be a function");
		}
		const callback = last as (group: RouteGroup<string, TState>) => void;
		const groupMws: Middleware[] = [...this.middlewares];
		for (let i = 0; i < args.length - 1; i++) {
			const item = args[i];
			if (Array.isArray(item)) {
				for (let j = 0; j < item.length; j++)
					groupMws.push(item[j] as Middleware);
			} else if (item && typeof item === "object") {
				groupMws.push(item as Middleware);
			}
		}
		const nestedGroup = new RouteGroup(this.app, nestedPrefix, groupMws);
		callback(nestedGroup);
		return this;
	}
}

export class App<TState extends object = Record<string, unknown>> {
	private readonly fetchHandler = (req: Request, srv?: Server<unknown>) =>
		this.handle(req, srv);
	private readonly trie = new SegmentTrie();
	private readonly middlewares: Middleware[] = [];
	private readonly nativeRoutes: Array<{
		method: HttpMethod;
		pattern: string;
		handler: ResponseHandler;
		rawHandler?: HandlerFunction;
		isDynamic: boolean;
		isContextFree: boolean;
		isLightweight: boolean;
		isParamsOnly: boolean;
		isJsonBodyOnly: boolean;
		hasRouteMiddlewares: boolean;
	}> = [];
	private server: Server<unknown> | null = null;
	private clusterProcesses: ReturnType<typeof Bun.spawn>[] | null = null;
	private readonly _options: AppOptions;
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: Accessed through ContextApplication.
	private readonly redirectHosts: ReadonlySet<string>;
	readonly trustProxy:
		| boolean
		| string
		| readonly string[]
		| ((ip: string) => boolean);
	readonly trustedProxyChecker: (ip: string) => boolean;
	private stopPromise: Promise<ShutdownResult> | null = null;
	private notFoundHandler: NotFoundHandler | null = null;
	private errorHandler: ErrorHandler | null = null;
	private errorResolver: ErrorResolver | undefined = undefined;
	private globalPipeline: MiddlewareDispatcher = composeMiddlewareDispatcher(
		[],
	);
	private hasMiddlewares = false;
	private hasWebSockets = false;
	readonly development: boolean;
	readonly cookieSecret?: string;

	constructor(options: AppOptions = {}) {
		if (
			options.port !== undefined &&
			(!Number.isInteger(options.port) ||
				options.port < 0 ||
				options.port > 65535)
		) {
			throw new RangeError("port must be an integer between 0 and 65535");
		}
		if (
			options.maxRequestBodySize !== undefined &&
			(!Number.isSafeInteger(options.maxRequestBodySize) ||
				options.maxRequestBodySize < 0)
		) {
			throw new RangeError(
				"maxRequestBodySize must be a non-negative safe integer",
			);
		}
		if (
			options.idleTimeout !== undefined &&
			(!Number.isFinite(options.idleTimeout) ||
				options.idleTimeout < 0 ||
				options.idleTimeout > 255)
		) {
			throw new RangeError("idleTimeout must be between 0 and 255 seconds");
		}
		for (const [name, value] of [
			["websocket.maxPayloadLength", options.websocket?.maxPayloadLength],
			["websocket.backpressureLimit", options.websocket?.backpressureLimit],
		] as const) {
			if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
				throw new RangeError(`${name} must be a positive safe integer`);
			}
		}
		if (
			options.websocket?.idleTimeout !== undefined &&
			(!Number.isFinite(options.websocket.idleTimeout) ||
				options.websocket.idleTimeout < 0 ||
				options.websocket.idleTimeout > 255)
		) {
			throw new RangeError(
				"websocket.idleTimeout must be between 0 and 255 seconds",
			);
		}
		const trustedProxyRanges = Array.isArray(options.trustProxy)
			? options.trustProxy
			: typeof options.trustProxy === "string"
				? [options.trustProxy]
				: [];
		for (const range of trustedProxyRanges) {
			if (!isIpRange(range)) {
				throw new TypeError(`Invalid trustProxy IP range: ${range}`);
			}
		}
		if (options.cookieSecret !== undefined && !options.cookieSecret.trim()) {
			throw new TypeError("cookieSecret must be non-empty when provided");
		}
		this._options = options;
		this.development =
			options.development ?? process.env.NODE_ENV === "development";
		this.trustProxy = Array.isArray(options.trustProxy)
			? Object.freeze([...options.trustProxy])
			: (options.trustProxy ?? false);
		this.trustedProxyChecker = compileTrustProxy(options.trustProxy);
		this.cookieSecret = options.cookieSecret;
		this.redirectHosts = options.allowedRedirectHosts
			? createReadonlySet(
					new Set(options.allowedRedirectHosts.map((h) => h.toLowerCase())),
				)
			: EMPTY_REDIRECT_HOSTS;
	}

	plugin<TOptions>(
		pluginFn: (app: this, options?: TOptions) => void,
		options?: TOptions,
	): this {
		pluginFn(this, options);
		return this;
	}

	notFound(handler: NotFoundHandler): this {
		this.notFoundHandler = handler;
		return this;
	}

	onError(handler: ErrorHandler): this {
		this.errorHandler = handler;
		this.errorResolver = (err, ctx) => handler(err, ctx);
		if (this.server !== null) {
			this.globalPipeline = composeMiddlewareDispatcher(
				this.middlewares,
				this.errorResolver,
			);
		}
		return this;
	}

	_register(method: HttpMethod, pattern: string, args: unknown[]): this {
		return this._registerMethods([method], pattern, args);
	}

	_registerMethods(
		methods: readonly HttpMethod[],
		pattern: string,
		args: unknown[],
	): this {
		const { middlewares, handler } = parseRouteArgs(args);
		const responseHandler: (ctx: Context) => Response | Promise<Response> = (
			ctx,
		) => toResponse(handler(ctx));
		const finalHandler: (ctx: Context) => Response | Promise<Response> =
			middlewares.length === 0
				? responseHandler
				: composeMiddlewares(middlewares, responseHandler);

		const canonicalPattern = canonicalizeRoutePattern(pattern);
		validateRoutePattern(canonicalPattern);
		const routes = methods.map((method) => ({
			method,
			pattern: canonicalPattern,
			handler: finalHandler,
		}));
		this.trie.addBatch(routes);

		const needs = detectHandlerNeeds(handler);
		const hasRouteMws = middlewares.length > 0;

		for (const r of routes) {
			const variants = expandOptionalPatterns(r.pattern);
			for (const variant of variants) {
				this.nativeRoutes.push({
					method: r.method,
					pattern: variant,
					handler: r.handler,
					rawHandler: handler,
					isDynamic: variant.includes(":") || variant.includes("*"),
					isContextFree: needs.isContextFree && !hasRouteMws,
					isLightweight: needs.isLightweight && !hasRouteMws,
					isParamsOnly: needs.isParamsOnly && !hasRouteMws,
					isJsonBodyOnly: needs.isJsonBodyOnly && !hasRouteMws,
					hasRouteMiddlewares: hasRouteMws,
				});
			}
		}

		return this;
	}

	add<P extends string>(
		method: HttpMethod,
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	add<P extends string>(
		method: HttpMethod,
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	add(method: HttpMethod, pattern: string, ...args: unknown[]): this {
		return this._register(method, pattern, args);
	}

	get<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	get<P extends string>(
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	get(pattern: string, ...args: unknown[]): this {
		return this._register("GET", pattern, args);
	}

	post<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	post<P extends string>(
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	post(pattern: string, ...args: unknown[]): this {
		return this._register("POST", pattern, args);
	}

	put<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	put<P extends string>(
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	put(pattern: string, ...args: unknown[]): this {
		return this._register("PUT", pattern, args);
	}

	delete<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	delete<P extends string>(
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	delete(pattern: string, ...args: unknown[]): this {
		return this._register("DELETE", pattern, args);
	}

	patch<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	patch<P extends string>(
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	patch(pattern: string, ...args: unknown[]): this {
		return this._register("PATCH", pattern, args);
	}

	head<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	head<P extends string>(
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	head(pattern: string, ...args: unknown[]): this {
		return this._register("HEAD", pattern, args);
	}

	options<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	options<P extends string>(
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	options(pattern: string, ...args: unknown[]): this {
		return this._register("OPTIONS", pattern, args);
	}

	all<P extends string>(
		pattern: P,
		handler: Handler<RouteParams<P>, TState>,
	): this;
	all<P extends string>(
		pattern: P,
		...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]
	): this;
	all(pattern: string, ...args: unknown[]): this {
		return this._registerMethods(METHODS, pattern, args);
	}

	ws<P extends string, TData = unknown>(
		pattern: P,
		handlers: WebSocketHandlers<TData>,
		beforeUpgrade?: (
			ctx: Context<RouteParams<P>, TState>,
		) => boolean | { data?: TData } | Promise<boolean | { data?: TData }>,
	): this {
		this.hasWebSockets = true;
		return this._registerMethods(["GET"], pattern, [
			async (ctx: Context<RouteParams<typeof pattern>, TState>) => {
				if (ctx.req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
					return new Response("Upgrade Required", { status: 426 });
				}
				let customData: unknown;
				if (beforeUpgrade) {
					const check = await beforeUpgrade(ctx);
					if (!check) return new Response("Unauthorized", { status: 401 });
					if (typeof check === "object" && check !== null && "data" in check) {
						customData = (check as { data?: unknown }).data;
					}
				}
				const upgradeData =
					customData !== undefined &&
					typeof customData === "object" &&
					customData !== null
						? { ...customData, handlers, _barqInternal: true }
						: { handlers, _barqInternal: true, data: customData };
				const upgraded = ctx.upgrade(upgradeData);
				return upgraded
					? new Response(null)
					: new Response("WebSocket upgrade failed", { status: 400 });
			},
		]);
	}

	group<Prefix extends string>(
		prefix: Prefix,
		callback: (group: RouteGroup<Prefix, TState>) => void,
	): this;
	group<Prefix extends string>(
		prefix: Prefix,
		...args: [...RouteHandlerArg[], (group: RouteGroup<Prefix, TState>) => void]
	): this;
	group(prefix: string, ...args: unknown[]): this {
		const last = args[args.length - 1];
		if (typeof last !== "function") {
			throw new Error("Route group callback must be a function");
		}
		const callback = last as (group: RouteGroup<string, TState>) => void;
		const groupMws: Middleware[] = [];
		for (let i = 0; i < args.length - 1; i++) {
			const item = args[i];
			if (Array.isArray(item)) {
				for (let j = 0; j < item.length; j++)
					groupMws.push(item[j] as Middleware);
			} else if (item && typeof item === "object") {
				groupMws.push(item as Middleware);
			}
		}
		const normalizedPrefix = normalizePrefix(prefix);
		const group = new RouteGroup(this, normalizedPrefix, groupMws);
		callback(group);
		return this;
	}

	use<const TMiddlewares extends readonly Middleware<TState, object>[]>(
		...middlewares: TMiddlewares
	): App<TState & MiddlewareOutputs<TMiddlewares>> {
		for (let i = 0; i < middlewares.length; i++) {
			this.middlewares.push(middlewares[i]! as Middleware);
		}
		this.hasMiddlewares = this.middlewares.length > 0;
		if (this.server !== null) {
			this.globalPipeline = composeMiddlewareDispatcher(
				this.middlewares,
				this.errorResolver,
			);
		}
		return this as unknown as App<TState & MiddlewareOutputs<TMiddlewares>>;
	}

	listen(port?: number): Server<unknown> {
		const listenPort = port ?? this._options.port ?? 0;
		if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
			throw new RangeError("port must be an integer between 0 and 65535");
		}
		if (this.stopPromise !== null) {
			throw new Error("App cannot listen while shutdown is in progress");
		}
		if (this.server !== null) {
			throw new Error("App is already listening");
		}
		const userWs = this._options.websocket;
		this.globalPipeline = composeMiddlewareDispatcher(
			this.middlewares,
			this.errorResolver,
		);
		const contextApplication = this as unknown as ContextApplication;
		const opts: Record<string, unknown> = {
			fetch: this.fetchHandler,
			development: this.development,
		};
		if (this._options.idleTimeout !== undefined) {
			opts.idleTimeout = this._options.idleTimeout;
		}
		if (this._options.maxRequestBodySize !== undefined) {
			opts.maxRequestBodySize = this._options.maxRequestBodySize;
		}
		opts.error = (err: unknown) => errorToResponse(err, this.development);
		if (Bun.env.BARQ_IS_WORKER === "true") opts.reusePort = true;

		if (this.hasWebSockets || userWs !== undefined) {
			opts.websocket = {
				...userWs,
				message: (ws: ServerWebSocket<unknown>, message: string | Buffer) => {
					const internal = getInternalWebSocketHandlers(ws);
					dispatchWebSocketCallback(internal?.message, [ws, message], (err) =>
						reportWebSocketError(internal?.error, ws, err),
					);
					dispatchWebSocketCallback(userWs?.message, [ws, message], (err) =>
						reportWebSocketError(userWs?.error, ws, err),
					);
				},
				open: (ws: ServerWebSocket<unknown>) => {
					const internal = getInternalWebSocketHandlers(ws);
					dispatchWebSocketCallback(internal?.open, [ws], (err) =>
						reportWebSocketError(internal?.error, ws, err),
					);
					dispatchWebSocketCallback(userWs?.open, [ws], (err) =>
						reportWebSocketError(userWs?.error, ws, err),
					);
				},
				close: (ws: ServerWebSocket<unknown>, code: number, reason: string) => {
					const internal = getInternalWebSocketHandlers(ws);
					dispatchWebSocketCallback(
						internal?.close,
						[ws, code, reason],
						(err) => reportWebSocketError(internal?.error, ws, err),
					);
					dispatchWebSocketCallback(userWs?.close, [ws, code, reason], (err) =>
						reportWebSocketError(userWs?.error, ws, err),
					);
				},
				drain: (ws: ServerWebSocket<unknown>) => {
					const internal = getInternalWebSocketHandlers(ws);
					dispatchWebSocketCallback(internal?.drain, [ws], (err) =>
						reportWebSocketError(internal?.error, ws, err),
					);
					dispatchWebSocketCallback(userWs?.drain, [ws], (err) =>
						reportWebSocketError(userWs?.error, ws, err),
					);
				},
				error: (ws: ServerWebSocket<unknown>, err: unknown) => {
					const internal = getInternalWebSocketHandlers(ws);
					if (internal?.error === undefined && userWs?.error === undefined) {
						console.error("Unhandled WebSocket error:", err);
						return;
					}
					if (internal?.error) reportWebSocketError(internal.error, ws, err);
					if (userWs?.error) reportWebSocketError(userWs.error, ws, err);
				},
			};
		}

		if (this.nativeRoutes.length > 0) {
			const systemRoutes: Record<string, unknown> = Object.create(null);
			const hasGlobalPipeline =
				this.hasMiddlewares || this.errorResolver !== undefined;
			const routesByPattern = new Map<string, typeof this.nativeRoutes>();

			for (const nr of this.nativeRoutes) {
				let list = routesByPattern.get(nr.pattern);
				if (!list) {
					list = [];
					routesByPattern.set(nr.pattern, list);
				}
				list.push(nr);
			}

			for (const [pattern, list] of routesByPattern) {
				const isDynamic = pattern.includes(":") || pattern.includes("*");
				const methodMap: Record<
					string,
					Response | ((req: Request) => Response | Promise<Response>)
				> = Object.create(null);

				for (const nr of list) {
					const h = nr.handler;
					const isDyn = nr.isDynamic;
					const raw = nr.rawHandler;

					if (hasGlobalPipeline || nr.hasRouteMiddlewares) {
						methodMap[nr.method] = (req: Request) => {
							try {
								const params = isDyn
									? ((req as unknown as { params?: Record<string, string> })
											.params ?? EMPTY_PARAMS)
									: EMPTY_PARAMS;
								const ctx = new Context(
									req,
									this.server,
									params,
									contextApplication,
								);
								const result = this.globalPipeline(ctx, h);
								return finalizeResponse(ctx, result, req.method === "HEAD");
							} catch (err) {
								return errorToResponse(err, this.development);
							}
						};
					} else if (nr.isContextFree && raw) {
						const analysis = analyzeHandler(raw);
						const literal = analysis.literal;
						if (literal !== null) {
							if (literal.kind === "string") {
								methodMap[nr.method] = new Response(literal.value);
								if (nr.method === "GET" && !isDyn)
									methodMap.HEAD = new Response(null);
							} else {
								methodMap[nr.method] = new Response(literal.value, {
									headers: FAST_JSON_HEADERS,
								});
								if (nr.method === "GET" && !isDyn)
									methodMap.HEAD = new Response(null, {
										headers: FAST_JSON_HEADERS,
									});
							}
						} else {
							methodMap[nr.method] = () => {
								const res = raw();
								if (res instanceof Response) return res;
								if (isThenable(res)) {
									return Promise.resolve(res).then((r) => {
										if (r instanceof Response) return r;
										if (typeof r === "object" && r !== null)
											return Response.json(r);
										if (typeof r === "string")
											return new Response(r, { headers: FAST_TEXT_HEADERS });
										return finalizeValue(r as HandlerResult);
									});
								}
								if (typeof res === "object" && res !== null)
									return Response.json(res);
								if (typeof res === "string")
									return new Response(res, { headers: FAST_TEXT_HEADERS });
								return finalizeValue(res as HandlerResult);
							};
							if (nr.method === "GET" && !isDyn) {
								methodMap.HEAD = () => {
									const res = raw();
									if (isThenable(res))
										return Promise.resolve(res).then(
											(r) =>
												stripBody(
													r instanceof Response
														? r
														: finalizeValue(r as HandlerResult),
												),
											(err: unknown) => errorToResponse(err, this.development),
										);
									return stripBody(
										res instanceof Response
											? res
											: finalizeValue(res as HandlerResult),
									);
								};
							}
						}
					} else if (nr.isJsonBodyOnly && raw) {
						methodMap[nr.method] = (req: Request) =>
							new Response(req.body, { headers: FAST_JSON_HEADERS });
						if (nr.method === "GET" && !isDyn) {
							methodMap.HEAD = (req: Request) =>
								req.json().then(
									() => new Response(null, { headers: FAST_JSON_HEADERS }),
									(err: unknown) => errorToResponse(err, this.development),
								);
						}
					} else if (nr.isParamsOnly && raw) {
						const analysis = analyzeHandler(raw);
						if (analysis.paramSerializer) {
							const serializer = analysis.paramSerializer;
							const responseInit = { headers: FAST_JSON_HEADERS };
							methodMap[nr.method] = (req: Request) => {
								const params =
									(
										req as unknown as {
											params?: Record<string, string>;
										}
									).params ?? EMPTY_PARAMS;
								const syncRes = raw({ params } as never);
								if (syncRes instanceof Response) return syncRes;
								if (isThenable(syncRes)) {
									return Promise.resolve(syncRes).then(
										(val) => {
											if (val instanceof Response) return val;
											if (typeof val === "object" && val !== null)
												return new Response(JSON.stringify(val), {
													headers: FAST_JSON_HEADERS,
												});
											if (typeof val === "string")
												return new Response(val, {
													headers: FAST_TEXT_HEADERS,
												});
											return finalizeValue(val as HandlerResult);
										},
										(err: unknown) => errorToResponse(err, this.development),
									);
								}
								return new Response(serializer(params), responseInit);
							};
						} else {
							methodMap[nr.method] = (req: Request) => {
								const p = (
									req as unknown as { params?: Record<string, string> }
								).params;
								const res = raw(
									(p ? req : { params: EMPTY_PARAMS, req }) as never,
								);
								if (res instanceof Response) return res;
								if (isThenable(res)) {
									return Promise.resolve(res).then((r) => {
										if (r instanceof Response) return r;
										if (typeof r === "object" && r !== null)
											return new Response(JSON.stringify(r), {
												headers: FAST_JSON_HEADERS,
											});
										if (typeof r === "string")
											return new Response(r, { headers: FAST_TEXT_HEADERS });
										return finalizeValue(r as HandlerResult);
									});
								}
								if (typeof res === "object" && res !== null)
									return Response.json(res);
								if (typeof res === "string")
									return new Response(res, { headers: FAST_TEXT_HEADERS });
								return new Response(JSON.stringify(res), {
									headers: FAST_JSON_HEADERS,
								});
							};
							if (nr.method === "GET" && !isDyn)
								methodMap.HEAD = () =>
									new Response(null, { headers: FAST_JSON_HEADERS });
						}
					} else if (nr.isLightweight && raw) {
						methodMap[nr.method] = (req: Request) => {
							const params = isDyn
								? ((req as unknown as { params?: Record<string, string> })
										.params ?? EMPTY_PARAMS)
								: EMPTY_PARAMS;
							const ctx = acquireLightContext(req, params);
							let res: unknown;
							try {
								res = raw(ctx as never);
							} catch (err) {
								releaseLightContext(ctx);
								return errorToResponse(err, this.development);
							}
							if (res instanceof Response) {
								releaseLightContext(ctx);
								return res;
							}
							if (isThenable(res)) {
								return Promise.resolve(res)
									.then(
										(r) => {
											releaseLightContext(ctx);
											if (r instanceof Response) return r;
											if (typeof r === "object" && r !== null)
												return new Response(JSON.stringify(r), {
													headers: FAST_JSON_HEADERS,
												});
											if (typeof r === "string")
												return new Response(r, { headers: FAST_TEXT_HEADERS });
											return finalizeValue(r as HandlerResult);
										},
										(err: unknown) => {
											releaseLightContext(ctx);
											return errorToResponse(err, this.development);
										},
									)
									.catch((err: unknown) =>
										errorToResponse(err, this.development),
									);
							}
							releaseLightContext(ctx);
							if (typeof res === "object" && res !== null)
								return Response.json(res);
							if (typeof res === "string")
								return new Response(res, { headers: FAST_TEXT_HEADERS });
							return finalizeValue(res as HandlerResult);
						};
						if (nr.method === "GET" && !isDyn)
							methodMap.HEAD = () =>
								new Response(null, { headers: FAST_JSON_HEADERS });
					} else {
						methodMap[nr.method] = (req: Request) => {
							const isHead = nr.method === "GET" && req.method === "HEAD";
							try {
								const params = isDyn
									? ((req as unknown as { params?: Record<string, string> })
											.params ?? EMPTY_PARAMS)
									: EMPTY_PARAMS;
								const ctx = new Context(
									req,
									this.server,
									params,
									contextApplication,
								);
								const res = raw ? raw(ctx as never) : h(ctx);
								if (res instanceof Response) {
									if (!isHead && !ctx._hasPendingCookies) return res;
									return finalizeResponse(ctx, res, isHead);
								}
								if (!isThenable(res))
									return finalizeResponse(
										ctx,
										toResponse(res as HandlerResult),
										isHead,
									);
								return Promise.resolve(res)
									.then((value) =>
										finalizeResponse(
											ctx,
											toResponse(value as HandlerResult),
											isHead,
										),
									)
									.catch((err: unknown) =>
										finalizeResponse(
											ctx,
											errorToResponse(err, this.development),
											isHead,
										),
									);
							} catch (err) {
								return errorToResponse(err, this.development);
							}
						};
					}
				}

				const allowMethods = Object.keys(methodMap);
				const allowHeader =
					allowMethods.includes("GET") && !allowMethods.includes("HEAD")
						? [...allowMethods, "HEAD"].join(", ")
						: allowMethods.join(", ");

				if (isDynamic) {
					const getFn = methodMap.GET;
					if (
						allowMethods.length === 1 &&
						typeof getFn === "function" &&
						allowMethods[0] === "GET"
					) {
						systemRoutes[pattern] = methodMap;
					} else {
						systemRoutes[pattern] = (req: Request) => {
							const matched = methodMap[req.method];
							if (typeof matched === "function") return matched(req);
							if (matched instanceof Response)
								return req.method === "HEAD" ? stripBody(matched) : matched;
							if (req.method === "HEAD") {
								const gh = methodMap.GET;
								if (typeof gh === "function") {
									const res = gh(req);
									return isThenable(res)
										? (res as Promise<Response>).then(stripBody)
										: stripBody(res as Response);
								}
							}
							return new Response('{"error":"Method Not Allowed"}', {
								status: 405,
								headers: {
									"content-type": "application/json; charset=utf-8",
									Allow: allowHeader,
								},
							});
						};
					}
				} else {
					systemRoutes[pattern] = methodMap;
				}
			}

			opts.routes = systemRoutes;
		}

		opts.port = listenPort;
		if (this._options.hostname !== undefined)
			opts.hostname = this._options.hostname;
		if (this._options.tls !== undefined) opts.tls = this._options.tls;
		this.server = Bun.serve(opts as unknown as ServeOptions);
		return this.server;
	}

	private handle(
		req: Request,
		srv?: Server<unknown>,
	): Response | Promise<Response> {
		const isHead = req.method === "HEAD";
		const serverInstance = srv ?? this.server;
		const contextApplication = this as unknown as ContextApplication;
		let currentCtx: Context | null = null;
		let pathname: string | undefined;

		try {
			pathname = scanPathname(req.url);

			const matched = this.trie.match(req.method, pathname);

			if (matched === null) {
				if (
					this.notFoundHandler === null &&
					!this.hasMiddlewares &&
					this.errorResolver === undefined
				) {
					return new Response('{"error":"Not Found"}', {
						status: 404,
						headers: { "content-type": "application/json; charset=utf-8" },
					});
				}
				currentCtx = new Context(
					req,
					serverInstance,
					EMPTY_PARAMS,
					contextApplication,
					pathname,
				);
				const notFoundHandler =
					this.notFoundHandler !== null
						? this.notFoundHandler
						: () =>
								new Response('{"error":"Not Found"}', {
									status: 404,
									headers: {
										"content-type": "application/json; charset=utf-8",
									},
								});
				const result = this.globalPipeline(currentCtx, notFoundHandler);
				return finalizeResponse(currentCtx, result, isHead);
			}

			if (!this.hasMiddlewares && this.errorResolver === undefined) {
				if (typeof matched === "function") {
					if (matched.length === 0) {
						const res = (
							matched as unknown as () => Response | Promise<Response>
						)();
						if (!isHead && !isThenable(res)) return res;
						if (isThenable(res)) {
							return (res as Promise<Response>).then(
								(r) => (isHead ? stripBody(r) : r),
								(err) => errorToResponse(err, this.development),
							);
						}
						return isHead ? stripBody(res) : res;
					}
					currentCtx = new Context(
						req,
						serverInstance,
						EMPTY_PARAMS,
						contextApplication,
						pathname,
					);
					const res = (matched as ResponseHandler)(currentCtx);
					if (!isHead && !isThenable(res)) {
						if (
							typeof res === "object" &&
							res !== null &&
							!(res instanceof Response)
						) {
							return new Response(JSON.stringify(res), {
								headers: FAST_JSON_HEADERS,
							});
						}
						if (!currentCtx._hasPendingCookies) return res;
					}
					return finalizeResponse(
						currentCtx,
						guardRejections(res, this.development),
						isHead,
					);
				}

				const handler =
					typeof matched === "object" && MATCH_HANDLER in matched
						? matched[MATCH_HANDLER]
						: undefined;
				if (handler !== undefined) {
					const params = matched as TrieParams;
					currentCtx = new Context(
						req,
						serverInstance,
						params,
						contextApplication,
						pathname,
					);
					const res = handler(currentCtx);
					if (!isHead && !isThenable(res)) {
						if (!currentCtx._hasPendingCookies) return res;
					}
					return finalizeResponse(
						currentCtx,
						guardRejections(res, this.development),
						isHead,
					);
				}
			}

			if (typeof matched === "function") {
				currentCtx = new Context(
					req,
					serverInstance,
					EMPTY_PARAMS,
					contextApplication,
					pathname,
				);
				const result = this.globalPipeline(currentCtx, matched);
				return finalizeResponse(currentCtx, result, isHead);
			}

			if (MATCH_NOT_ALLOWED in matched) {
				const allow = (matched as { [MATCH_NOT_ALLOWED]: string })[
					MATCH_NOT_ALLOWED
				];
				if (
					this.errorHandler === null &&
					!this.hasMiddlewares &&
					this.errorResolver === undefined
				) {
					return new Response('{"error":"Method Not Allowed"}', {
						status: 405,
						headers: {
							"content-type": "application/json; charset=utf-8",
							Allow: allow,
						},
					});
				}
				currentCtx = new Context(
					req,
					serverInstance,
					EMPTY_PARAMS,
					contextApplication,
					pathname,
				);
				const notAllowedHandler = () =>
					errorToResponse(
						new HttpError(
							405,
							{ error: "Method Not Allowed" },
							{ Allow: allow },
						),
						this.development,
					);
				const result = this.globalPipeline(currentCtx, notAllowedHandler);
				return finalizeResponse(currentCtx, result, isHead);
			}

			const params = matched as TrieParams;
			const handler = params[MATCH_HANDLER] as ResponseHandler;
			currentCtx = new Context(
				req,
				serverInstance,
				params,
				contextApplication,
				pathname,
			);
			const result = this.globalPipeline(currentCtx, handler);
			return finalizeResponse(currentCtx, result, isHead);
		} catch (err) {
			const activeCtx =
				currentCtx ??
				new Context(
					req,
					serverInstance,
					EMPTY_PARAMS,
					contextApplication,
					pathname,
				);
			if (this.errorHandler !== null) {
				try {
					const custom = this.errorHandler(err, activeCtx);
					const result = isThenable(custom)
						? (custom as Promise<Response>).then((r) =>
								unwindAfter(
									this.middlewares,
									activeCtx,
									r,
									0,
									this.errorResolver,
								),
							)
						: unwindAfter(
								this.middlewares,
								activeCtx,
								custom as Response,
								0,
								this.errorResolver,
							);
					return finalizeResponse(activeCtx, result, isHead);
				} catch (e2) {
					const fallback = errorToResponse(e2, this.development);
					const result = unwindAfter(
						this.middlewares,
						activeCtx,
						fallback,
						0,
						this.errorResolver,
					);
					return finalizeResponse(activeCtx, result, isHead);
				}
			}
			const routingErr = errorToResponse(err, this.development);
			const result = unwindAfter(
				this.middlewares,
				activeCtx,
				routingErr,
				0,
				this.errorResolver,
			);
			return finalizeResponse(activeCtx, result, isHead);
		}
	}

	cluster(port?: number): Server<unknown> | void {
		const listenPort = port ?? this._options.port ?? 3000;
		const isWorker = Bun.env.BARQ_IS_WORKER === "true";

		if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
			throw new RangeError("port must be an integer between 0 and 65535");
		}

		if (isWorker || process.platform !== "linux") {
			return this.listen(listenPort);
		}
		if (listenPort === 0) {
			throw new RangeError("cluster requires a fixed, non-zero port");
		}
		if (this.clusterProcesses !== null || this.server !== null) {
			throw new Error("App is already listening or clustering");
		}
		const entry = process.argv[1];
		if (!entry) {
			throw new Error("Cannot start cluster without an application entry file");
		}

		const processes: ReturnType<typeof Bun.spawn>[] = [];
		let crashCount = 0;
		let lastReset = Date.now();

		const spawnWorker = () => {
			const proc = Bun.spawn([process.execPath, "run", entry], {
				env: {
					...process.env,
					BARQ_IS_WORKER: "true",
					PORT: String(listenPort),
				},
				stdio: ["inherit", "inherit", "inherit"],
			});
			proc.exited.then((_code) => {
				if (this.stopPromise === null && this.clusterProcesses !== null) {
					const now = Date.now();
					if (now - lastReset > 5000) {
						crashCount = 0;
						lastReset = now;
					}
					crashCount++;

					const idx = processes.indexOf(proc);
					if (idx !== -1) {
						processes.splice(idx, 1);
					}

					if (crashCount > 15) {
						console.error(
							"[Barq Cluster] Workers restarting too fast. Throttling respawn.",
						);
						setTimeout(() => {
							if (this.stopPromise === null && this.clusterProcesses !== null) {
								processes.push(spawnWorker());
							}
						}, 2000);
						return;
					}

					processes.push(spawnWorker());
				}
			});
			return proc;
		};

		try {
			for (let i = 0; i < cpus().length; i++) {
				processes.push(spawnWorker());
			}
		} catch (error) {
			for (const process of processes) process.kill("SIGTERM");
			throw error;
		}
		this.clusterProcesses = processes;
		return;
	}

	async stop(hardTimeoutMs = 5000): Promise<ShutdownResult> {
		if (!Number.isFinite(hardTimeoutMs) || hardTimeoutMs < 0) {
			throw new RangeError(
				"hardTimeoutMs must be a finite non-negative number",
			);
		}
		if (this.stopPromise !== null) {
			return this.stopPromise;
		}
		const server = this.server;
		const clusterProcesses = this.clusterProcesses;
		this.server = null;
		this.clusterProcesses = null;
		if (server === null && clusterProcesses === null) {
			return { forced: false, pending: 0 };
		}
		this.stopPromise = (async () => {
			let serverResult: ShutdownResult = { forced: false, pending: 0 };
			let workersForced = false;
			try {
				if (server !== null) {
					serverResult = await stopServer(server, hardTimeoutMs);
				}
			} finally {
				if (clusterProcesses !== null) {
					workersForced = await stopClusterProcesses(
						clusterProcesses,
						hardTimeoutMs,
					);
				}
			}
			return {
				forced: serverResult.forced || workersForced,
				pending: serverResult.pending,
			};
		})();
		try {
			return await this.stopPromise;
		} finally {
			this.stopPromise = null;
		}
	}
}

function guardRejections(
	res: Response | Promise<Response>,
	development: boolean,
): Response | Promise<Response> {
	return isThenable(res)
		? (res as Promise<Response>).catch((err: unknown) =>
				errorToResponse(err, development),
			)
		: (res as Response);
}

function applyCookies(ctx: Context, res: Response): Response {
	if (!ctx._hasPendingCookies) return res;
	const cookies = ctx._cookieJarIfCreated();
	if (cookies === null) return res;
	const headers = new Headers(res.headers);
	applyPendingCookies(cookies, headers);
	ctx._hasPendingCookies = false;
	return new Response(res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}

function finalizeResponse(
	ctx: Context,
	res: Response | Promise<Response>,
	isHead: boolean,
): Response | Promise<Response> {
	if (res instanceof Response) {
		if (!isHead && !ctx._hasPendingCookies) return res;
		const withCookies = applyCookies(ctx, res);
		return isHead ? stripBody(withCookies) : withCookies;
	}
	if (isThenable(res)) {
		return res.then((response) => {
			const withCookies = applyCookies(ctx, response);
			return isHead ? stripBody(withCookies) : withCookies;
		});
	}
	if (!isHead) {
		if (!ctx._hasPendingCookies) return res as Response;
		return applyCookies(ctx, res as Response);
	}
	return stripBody(applyCookies(ctx, res as Response));
}

function stripBody(res: Response): Response {
	if (res.body === null) return res;
	try {
		res.body.cancel?.().catch?.(() => {});
	} catch {}
	return new Response(null, {
		status: res.status,
		statusText: res.statusText,
		headers: res.headers,
	});
}
