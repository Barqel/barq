import type { ServeOptions, Server, ServerWebSocket } from "bun";
import { Context } from "./context";
import type { ShutdownResult } from "./internal/shutdown";
import type { ErrorHandler, Handler, HttpMethod, JoinPath, Middleware, NotFoundHandler, RouteParams, WebSocketHandlers } from "./types";
export type { ShutdownResult };
export type RouteHandlerArg = Middleware | readonly Middleware[];
type MiddlewareOutput<TMiddleware> = TMiddleware extends {
    before?: (...args: never[]) => infer TResult;
} ? Exclude<Awaited<TResult>, Response | void | undefined> extends infer TOutput extends object ? TOutput : never : never;
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer TIntersection) => void ? TIntersection : never;
type MiddlewareOutputs<TMiddlewares extends readonly unknown[]> = UnionToIntersection<MiddlewareOutput<TMiddlewares[number]>>;
export interface WebSocketOptions {
    maxPayloadLength?: number;
    backpressureLimit?: number;
    closeOnBackpressureLimit?: boolean;
    idleTimeout?: number;
    open?: (ws: ServerWebSocket<unknown>) => void | Promise<void>;
    message?: (ws: ServerWebSocket<unknown>, message: string | Buffer) => void | Promise<void>;
    close?: (ws: ServerWebSocket<unknown>, code: number, reason: string) => void | Promise<void>;
    drain?: (ws: ServerWebSocket<unknown>) => void | Promise<void>;
    error?: (ws: ServerWebSocket<unknown>, error: unknown) => void | Promise<void>;
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
export declare class RouteGroup<Prefix extends string = string, TState extends object = Record<string, unknown>> {
    private readonly app;
    readonly prefix: string;
    private readonly middlewares;
    constructor(app: App<TState>, prefix: string, middlewares?: Middleware[]);
    use<const TMiddlewares extends readonly Middleware<TState, object>[]>(...middlewares: TMiddlewares): RouteGroup<Prefix, TState & MiddlewareOutputs<TMiddlewares>>;
    plugin<TOptions>(pluginFn: (group: this, options?: TOptions) => void, options?: TOptions): this;
    private _register;
    private _registerMethods;
    add<P extends string>(method: HttpMethod, pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    add<P extends string>(method: HttpMethod, pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    get<P extends string>(pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    get<P extends string>(pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    post<P extends string>(pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    post<P extends string>(pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    put<P extends string>(pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    put<P extends string>(pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    delete<P extends string>(pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    delete<P extends string>(pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    patch<P extends string>(pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    patch<P extends string>(pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    head<P extends string>(pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    head<P extends string>(pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    options<P extends string>(pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    options<P extends string>(pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    all<P extends string>(pattern: P, handler: Handler<RouteParams<JoinPath<Prefix, P>>, TState>): this;
    all<P extends string>(pattern: P, ...handlers: [
        ...RouteHandlerArg[],
        Handler<RouteParams<JoinPath<Prefix, P>>, TState>
    ]): this;
    ws<P extends string, TData = unknown>(pattern: P, handlers: WebSocketHandlers<TData>, beforeUpgrade?: (ctx: Context<RouteParams<JoinPath<Prefix, P>>, TState>) => boolean | {
        data?: TData;
    } | Promise<boolean | {
        data?: TData;
    }>): this;
    group<Sub extends string>(prefix: Sub, callback: (group: RouteGroup<JoinPath<Prefix, Sub>, TState>) => void): this;
    group<Sub extends string>(prefix: Sub, ...args: [
        ...RouteHandlerArg[],
        (group: RouteGroup<JoinPath<Prefix, Sub>, TState>) => void
    ]): this;
}
export declare class App<TState extends object = Record<string, unknown>> {
    private readonly fetchHandler;
    private readonly trie;
    private readonly middlewares;
    private readonly nativeRoutes;
    private server;
    private clusterProcesses;
    private readonly _options;
    private readonly redirectHosts;
    readonly trustProxy: boolean | string | readonly string[] | ((ip: string) => boolean);
    readonly trustedProxyChecker: (ip: string) => boolean;
    private stopPromise;
    private notFoundHandler;
    private errorHandler;
    private errorResolver;
    private globalPipeline;
    private hasMiddlewares;
    private hasWebSockets;
    readonly development: boolean;
    readonly cookieSecret?: string;
    constructor(options?: AppOptions);
    plugin<TOptions>(pluginFn: (app: this, options?: TOptions) => void, options?: TOptions): this;
    notFound(handler: NotFoundHandler): this;
    onError(handler: ErrorHandler): this;
    /** @internal */
    _register(method: HttpMethod, pattern: string, args: unknown[]): this;
    /** @internal */
    _registerMethods(methods: readonly HttpMethod[], pattern: string, args: unknown[]): this;
    add<P extends string>(method: HttpMethod, pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    add<P extends string>(method: HttpMethod, pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    get<P extends string>(pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    get<P extends string>(pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    post<P extends string>(pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    post<P extends string>(pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    put<P extends string>(pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    put<P extends string>(pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    delete<P extends string>(pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    delete<P extends string>(pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    patch<P extends string>(pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    patch<P extends string>(pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    head<P extends string>(pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    head<P extends string>(pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    options<P extends string>(pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    options<P extends string>(pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    all<P extends string>(pattern: P, handler: Handler<RouteParams<P>, TState>): this;
    all<P extends string>(pattern: P, ...handlers: [...RouteHandlerArg[], Handler<RouteParams<P>, TState>]): this;
    ws<P extends string, TData = unknown>(pattern: P, handlers: WebSocketHandlers<TData>, beforeUpgrade?: (ctx: Context<RouteParams<P>, TState>) => boolean | {
        data?: TData;
    } | Promise<boolean | {
        data?: TData;
    }>): this;
    group<Prefix extends string>(prefix: Prefix, callback: (group: RouteGroup<Prefix, TState>) => void): this;
    group<Prefix extends string>(prefix: Prefix, ...args: [...RouteHandlerArg[], (group: RouteGroup<Prefix, TState>) => void]): this;
    use<const TMiddlewares extends readonly Middleware<TState, object>[]>(...middlewares: TMiddlewares): App<TState & MiddlewareOutputs<TMiddlewares>>;
    listen(port?: number): Server<unknown>;
    private handle;
    cluster(port?: number): Server<unknown> | void;
    stop(hardTimeoutMs?: number): Promise<ShutdownResult>;
}
//# sourceMappingURL=app.d.ts.map