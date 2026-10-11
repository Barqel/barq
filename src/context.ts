import type { Server } from "bun";
import { createCookieJar } from "./cookies";
import { redirect } from "./http";
import { ipMatchesRange, isValidIpAddress } from "./internal/ip";
import { scanPathname } from "./internal/pathname";
import { parseAllQueryParams } from "./internal/query";
import type { CookieJar, Params } from "./types";

export interface ContextApplication {
	readonly development: boolean;
	readonly redirectHosts: ReadonlySet<string>;
	readonly trustProxy:
		| boolean
		| string
		| readonly string[]
		| ((ip: string) => boolean);
	readonly trustedProxyChecker?: (ip: string) => boolean;
	readonly cookieSecret?: string;
}

type TrustProxy = ContextApplication["trustProxy"];
const TEXT_DECODER = new TextDecoder();

interface LazyFields<TState> {
	cookies?: CookieJar | null;
	state?: TState | null;
	ip?: string | null;
	valid?: unknown;
	bodyBufferPromise?: Promise<ArrayBuffer> | null;
	textPromise?: Promise<string> | null;
	jsonPromise?: Promise<unknown> | null;
	blobPromise?: Promise<Blob> | null;
	formDataPromise?: ReturnType<Request["formData"]> | null;
}

export class Context<
	TParams extends object = Params,
	TState extends object = Record<string, unknown>,
> {
	readonly req: Request;
	readonly params: TParams;
	/** @internal Set only when this request queues a cookie mutation. */
	_hasPendingCookies = false;

	private readonly server: Server<unknown> | null;
	private readonly application: ContextApplication;
	private _pathname: string | null;
	private _query: URLSearchParams | null = null;
	private _url: string | null = null;
	private _queryParams: Record<string, string> | null = null;
	private _lazy: LazyFields<TState> | null = null;

	constructor(
		req: Request,
		server: Server<unknown> | null,
		params: TParams,
		application: ContextApplication,
		pathname?: string,
	) {
		this.req = req;
		this.server = server;
		this.params = params;
		this.application = application;
		this._pathname = pathname ?? null;
		this._query = null;
	}

	private _getLazy(): LazyFields<TState> {
		let lazy = this._lazy;
		if (lazy === null) {
			lazy = {};
			this._lazy = lazy;
		}
		return lazy;
	}

	get development(): boolean {
		return this.application.development;
	}

	get redirectHosts(): ReadonlySet<string> {
		return this.application.redirectHosts;
	}

	get trustProxy(): TrustProxy {
		return this.application.trustProxy;
	}

	get cookies(): CookieJar {
		const lazy = this._getLazy();
		if (!lazy.cookies) {
			lazy.cookies = createCookieJar(
				this.application.cookieSecret ?? "",
				this.req.headers,
				() => {
					this._hasPendingCookies = true;
				},
			);
		}
		return lazy.cookies as CookieJar;
	}

	/** @internal Returns the jar without creating one. */
	_cookieJarIfCreated(): CookieJar | null {
		return this._lazy?.cookies ?? null;
	}

	get state(): TState {
		const lazy = this._getLazy();
		if (!lazy.state) {
			lazy.state = Object.create(null) as TState;
		}
		return lazy.state;
	}

	get valid(): unknown {
		const lazy = this._lazy;
		if (lazy && lazy.valid !== undefined) return lazy.valid;
		return (lazy?.state as Record<string, unknown> | null | undefined)?.valid;
	}

	set valid(val: unknown) {
		this._getLazy().valid = val;
		(this.state as Record<string, unknown>).valid = val;
	}

	get pathname(): string {
		if (this._pathname !== null) return this._pathname;
		const p = scanPathname(this.req.url);
		this._pathname = p;
		return p;
	}

	get query(): URLSearchParams {
		if (this._query) return this._query;
		const url = this.req.url;
		const qIdx = url.indexOf("?");
		if (qIdx === -1) {
			const sp = new URLSearchParams("");
			this._query = sp;
			return sp;
		}
		const hashIdx = url.indexOf("#", qIdx);
		const qStr =
			hashIdx === -1 ? url.slice(qIdx + 1) : url.slice(qIdx + 1, hashIdx);
		const sp = new URLSearchParams(qStr);
		this._query = sp;
		return sp;
	}

	queryParam(name: string): string | null {
		if (this._query) return this._query.get(name);
		if (this._queryParams === null) {
			if (this._url === null) this._url = this.req.url;
			this._queryParams = parseAllQueryParams(this._url);
		}
		return this._queryParams[name] ?? null;
	}

	queryParamAll(name: string): string[] {
		return this.query.getAll(name);
	}

	get ip(): string {
		const lazy = this._lazy;
		if (lazy && typeof lazy.ip === "string") return lazy.ip;
		const directIp = this.getDirectIp();
		if (!this.isTrustedProxy(directIp)) {
			this._getLazy().ip = directIp;
			return directIp;
		}

		const forwarded = this.req.headers.get("x-forwarded-for");
		if (forwarded) {
			const hops = forwarded.split(",").map((hop) => hop.trim());
			if (hops.every(isValidIpAddress)) {
				let clientIp = directIp;
				for (let i = hops.length - 1; i >= 0; i--) {
					if (clientIp && !this.isTrustedProxy(clientIp)) break;
					clientIp = hops[i]!;
				}
				this._getLazy().ip = clientIp;
				return clientIp;
			}
			this._getLazy().ip = directIp;
			return directIp;
		}

		for (const name of ["cf-connecting-ip", "x-real-ip"]) {
			const candidate = this.req.headers.get(name)?.trim();
			if (candidate && isValidIpAddress(candidate)) {
				this._getLazy().ip = candidate;
				return candidate;
			}
		}

		this._getLazy().ip = directIp;
		return directIp;
	}

	private isTrustedProxy(ip: string): boolean {
		const trust = this.trustProxy;
		if (trust === true) return true;
		if (trust === false || !ip) return false;
		if (this.application.trustedProxyChecker) {
			return this.application.trustedProxyChecker(ip);
		}
		if (typeof trust === "function") return trust(ip);
		if (typeof trust !== "string") {
			return trust.some((range) => ipMatchesRange(ip, range));
		}
		return ipMatchesRange(ip, trust);
	}

	private getDirectIp(): string {
		const info = this.server?.requestIP(this.req);
		return info?.address ?? "";
	}

	get bodyStream(): ReadableStream<Uint8Array> | null {
		return this.req.body;
	}

	stream(): ReadableStream<Uint8Array> | null {
		return this.req.body;
	}

	private _getBodyBuffer(): Promise<ArrayBuffer> {
		const lazy = this._getLazy();
		if (!lazy.bodyBufferPromise) {
			lazy.bodyBufferPromise = this.req.arrayBuffer().catch((err: unknown) => {
				lazy.bodyBufferPromise = null;
				throw err;
			});
		}
		return lazy.bodyBufferPromise;
	}

	arrayBuffer(): Promise<ArrayBuffer> {
		return this._getBodyBuffer();
	}

	text(): Promise<string> {
		const lazy = this._getLazy();
		if (!lazy.textPromise) {
			lazy.textPromise = this._getBodyBuffer()
				.then((buf) => TEXT_DECODER.decode(buf))
				.catch((err: unknown) => {
					lazy.textPromise = null;
					throw err;
				});
		}
		return lazy.textPromise;
	}

	json<T = unknown>(): Promise<T> {
		const lazy = this._getLazy();
		if (!lazy.jsonPromise) {
			lazy.jsonPromise = this._getBodyBuffer()
				.then((buf) => JSON.parse(TEXT_DECODER.decode(buf)))
				.catch((err: unknown) => {
					lazy.jsonPromise = null;
					throw err;
				});
		}
		return lazy.jsonPromise as Promise<T>;
	}

	blob(): Promise<Blob> {
		const lazy = this._getLazy();
		if (!lazy.blobPromise) {
			const ct =
				this.req.headers.get("content-type") ?? "application/octet-stream";
			lazy.blobPromise = this._getBodyBuffer()
				.then((buf) => new Blob([buf], { type: ct }))
				.catch((err: unknown) => {
					lazy.blobPromise = null;
					throw err;
				});
		}
		return lazy.blobPromise;
	}

	formData(): ReturnType<Request["formData"]> {
		const lazy = this._getLazy();
		if (!lazy.formDataPromise) {
			lazy.formDataPromise = this._getBodyBuffer()
				.then((buf) => {
					const ct = this.req.headers.get("content-type") ?? "";
					const tempRes = new Response(buf, {
						headers: { "content-type": ct },
					});
					return tempRes.formData();
				})
				.catch((err: unknown) => {
					lazy.formDataPromise = null;
					throw err;
				}) as ReturnType<Request["formData"]>;
		}
		return lazy.formDataPromise;
	}

	redirect(url: string, status = 302): Response {
		return redirect(url, status, this.redirectHosts);
	}

	upgrade<TData = unknown>(data?: TData): boolean {
		if (!this.server) {
			throw new Error(
				"Cannot upgrade WebSocket: server instance is not available",
			);
		}
		return this.server.upgrade(this.req, { data });
	}

	timeout(seconds: number): this {
		if (this.server) {
			this.server.timeout(this.req, seconds);
		}
		return this;
	}

	disableTimeout(): this {
		if (this.server) {
			this.server.timeout(this.req, 0);
		}
		return this;
	}
}
