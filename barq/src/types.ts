import type { ServerWebSocket } from "bun";

import type { Context } from "./context";

export type HttpMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "DELETE"
	| "PATCH"
	| "HEAD"
	| "OPTIONS";

export type BeforeResult<TOutput extends object = Record<string, unknown>> =
	| Response
	| TOutput
	| void
	| undefined
	| Promise<Response | TOutput | void | undefined>;
export type AfterResult =
	| Response
	| void
	| undefined
	| Promise<Response | void | undefined>;

export interface Middleware<
	TState extends object = Record<string, unknown>,
	TOutput extends object = Record<string, unknown>,
> {
	before?(ctx: Context<Params, TState>): BeforeResult<TOutput>;
	after?(ctx: Context<Params, TState>, res: Response): AfterResult;
}

export interface WebSocketHandlers<TData = unknown> {
	open?: (ws: ServerWebSocket<TData>) => void | Promise<void>;
	message?: (
		ws: ServerWebSocket<TData>,
		message: string | Buffer,
	) => void | Promise<void>;
	close?: (
		ws: ServerWebSocket<TData>,
		code: number,
		reason: string,
	) => void | Promise<void>;
	drain?: (ws: ServerWebSocket<TData>) => void | Promise<void>;
	error?: (ws: ServerWebSocket<TData>, error: unknown) => void | Promise<void>;
}

export type NotFoundHandler = (ctx: Context) => Response | Promise<Response>;
export type ErrorHandler = (
	error: unknown,
	ctx: Context,
) => Response | Promise<Response>;
export type ErrorResolver = (
	err: unknown,
	ctx: Context,
) => Response | Promise<Response>;

export type Params = Readonly<Record<string, string>>;

export interface CookieJar {
	get(name: string): string | undefined;
	getSigned(name: string, customSecret?: string): string | null;
	set(name: string, value: string, options?: SetCookieOptions): void;
	setSigned(
		name: string,
		value: string,
		options?: SetCookieOptions,
		customSecret?: string,
	): void;
	delete(name: string, options?: SetCookieOptions): void;
}

export interface SetCookieOptions {
	path?: string;
	domain?: string;
	maxAge?: number;
	expires?: Date;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
}

export type Handler<
	TParams extends object = Record<string, string>,
	TState extends object = Record<string, unknown>,
> = (ctx: Context<TParams, TState>) => HandlerResult | Promise<HandlerResult>;

/** Internal handlers return a Response after route values are normalized. */
export type ResponseHandler<
	TParams extends object = Record<string, string>,
	TState extends object = Record<string, unknown>,
> = (ctx: Context<TParams, TState>) => Response | Promise<Response>;

/** Values returned by route handlers are converted to HTTP responses. */
export type HandlerResult =
	| Response
	| string
	| number
	| boolean
	| bigint
	| symbol
	| null
	| undefined
	| object;

export type ExtractParam<Segment extends string> =
	Segment extends `:${infer Param}?`
		? { readonly [K in Param]?: string }
		: Segment extends `:${infer Param}`
			? { readonly [K in Param]: string }
			: Segment extends `*${infer Wildcard}`
				? Wildcard extends ""
					? { readonly "*": string }
					: { readonly [K in Wildcard]: string }
				: Record<never, never>;

export type ExtractParams<Path extends string> =
	Path extends `${infer Start}/${infer Rest}`
		? ExtractParam<Start> & ExtractParams<Rest>
		: ExtractParam<Path>;

export type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type RouteParams<Path extends string> = string extends Path
	? Record<string, string>
	: Simplify<ExtractParams<Path>>;

export type JoinPath<A extends string, B extends string> = A extends ""
	? B
	: B extends ""
		? A
		: B extends "/"
			? NormalizePrefix<A>
			: B extends `/${string}`
				? `${NormalizePrefix<A>}${B}`
				: `${NormalizePrefix<A>}/${B}`;

type NormalizePrefix<P extends string> = P extends ""
	? ""
	: P extends "/"
		? ""
		: P extends `/${infer Rest}`
			? Rest extends `${infer R}/`
				? R
				: Rest
			: P;
