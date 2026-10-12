import type { Server } from "bun";
import type { CookieJar, Params } from "./types";
export interface ContextApplication {
    readonly development: boolean;
    readonly redirectHosts: ReadonlySet<string>;
    readonly trustProxy: boolean | string | readonly string[] | ((ip: string) => boolean);
    readonly trustedProxyChecker?: (ip: string) => boolean;
    readonly cookieSecret?: string;
}
type TrustProxy = ContextApplication["trustProxy"];
export declare class Context<TParams extends object = Params, TState extends object = Record<string, unknown>> {
    readonly req: Request;
    readonly params: TParams;
    /** @internal Set only when this request queues a cookie mutation. */
    _hasPendingCookies: boolean;
    private readonly server;
    private readonly application;
    private _pathname;
    private _query;
    private _url;
    private _queryParams;
    private _lazy;
    constructor(req: Request, server: Server<unknown> | null, params: TParams, application: ContextApplication, pathname?: string);
    private _getLazy;
    get development(): boolean;
    get redirectHosts(): ReadonlySet<string>;
    get trustProxy(): TrustProxy;
    get cookies(): CookieJar;
    /** @internal Returns the jar without creating one. */
    _cookieJarIfCreated(): CookieJar | null;
    get state(): TState;
    get valid(): unknown;
    set valid(val: unknown);
    get pathname(): string;
    get query(): URLSearchParams;
    queryParam(name: string): string | null;
    queryParamAll(name: string): string[];
    get ip(): string;
    private isTrustedProxy;
    private getDirectIp;
    get bodyStream(): ReadableStream<Uint8Array> | null;
    stream(): ReadableStream<Uint8Array> | null;
    private _getBodyBuffer;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    blob(): Promise<Blob>;
    formData(): ReturnType<Request["formData"]>;
    redirect(url: string, status?: number): Response;
    upgrade<TData = unknown>(data?: TData): boolean;
    timeout(seconds: number): this;
    disableTimeout(): this;
}
export {};
//# sourceMappingURL=context.d.ts.map