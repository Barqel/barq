import type { Context } from "@barqel/barq";
import { CircuitBreaker } from "./circuit-breaker";
import { computeBackoffDelay, defaultRetryOn } from "./retry";
import type {
	ClientOptions,
	ClientRequestOptions,
	ClientResponse,
	QueryParams,
	RetryOptions,
} from "./types";

export class BarqClient {
	private readonly options: ClientOptions;
	private readonly circuitBreaker: CircuitBreaker;

	constructor(options: ClientOptions = {}) {
		this.options = {
			timeoutMs: 10_000,
			...options,
		};

		const cbOpts =
			options.circuitBreaker === false
				? { enabled: false }
				: (options.circuitBreaker ?? {});
		this.circuitBreaker = new CircuitBreaker(cbOpts);
	}

	get(path: string, options?: ClientRequestOptions): Promise<ClientResponse> {
		return this.request("GET", path, options);
	}

	post(path: string, options?: ClientRequestOptions): Promise<ClientResponse> {
		return this.request("POST", path, options);
	}

	put(path: string, options?: ClientRequestOptions): Promise<ClientResponse> {
		return this.request("PUT", path, options);
	}

	delete(
		path: string,
		options?: ClientRequestOptions,
	): Promise<ClientResponse> {
		return this.request("DELETE", path, options);
	}

	patch(path: string, options?: ClientRequestOptions): Promise<ClientResponse> {
		return this.request("PATCH", path, options);
	}

	withContext(ctx: Context): BarqClient {
		return new BarqClient({
			...this.options,
			onRequest: (req) => {
				const reqId =
					(ctx.state as Record<string, unknown>).requestId ??
					ctx.req.headers.get("x-request-id");
				if (reqId && !req.headers.has("x-request-id")) {
					req.headers.set("x-request-id", String(reqId));
				}
				return this.options.onRequest?.(req);
			},
		});
	}

	async request(
		method: string,
		path: string,
		options: ClientRequestOptions = {},
	): Promise<ClientResponse> {
		this.circuitBreaker.assertCanExecute();

		const retryConfig: RetryOptions | false =
			options.retry !== undefined ? options.retry : (this.options.retry ?? {});

		const maxRetries = retryConfig === false ? 0 : (retryConfig.retries ?? 3);
		const retryPredicate =
			retryConfig === false
				? () => false
				: (retryConfig.retryOn ?? defaultRetryOn);

		let lastError: unknown;
		let lastResponse: Response | undefined;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			if (attempt > 0 && retryConfig !== false) {
				const delay = computeBackoffDelay(attempt - 1, retryConfig);
				await Bun.sleep(delay);
			}

			try {
				const req = this.buildRequest(method, path, options);
				if (this.options.onRequest) {
					await this.options.onRequest(req);
				}

				const res = await fetch(req);
				if (this.options.onResponse) {
					await this.options.onResponse(res, req);
				}

				if (attempt < maxRetries && retryPredicate(undefined, res)) {
					lastResponse = res;
					continue;
				}

				if (res.status >= 500) {
					this.circuitBreaker.recordFailure();
				} else {
					this.circuitBreaker.recordSuccess();
				}

				return wrapClientResponse(res);
			} catch (err) {
				lastError = err;
				if (attempt < maxRetries && retryPredicate(err, undefined)) {
					continue;
				}
				this.circuitBreaker.recordFailure();
				throw err;
			}
		}

		if (lastResponse) {
			if (lastResponse.status >= 500) {
				this.circuitBreaker.recordFailure();
			} else {
				this.circuitBreaker.recordSuccess();
			}
			return wrapClientResponse(lastResponse);
		}

		this.circuitBreaker.recordFailure();
		throw lastError;
	}

	private buildRequest(
		method: string,
		path: string,
		options: ClientRequestOptions,
	): Request {
		const url = this.buildUrl(path, options.query);
		const headers = new Headers(this.options.headers);

		if (options.headers) {
			if (options.headers instanceof Headers) {
				options.headers.forEach((v, k) => {
					headers.set(k, v);
				});
			} else {
				for (const [k, v] of Object.entries(options.headers)) {
					headers.set(k, v);
				}
			}
		}

		if (options.ctx) {
			const reqId =
				(options.ctx.state as Record<string, unknown>).requestId ??
				options.ctx.req.headers.get("x-request-id");
			if (reqId && !headers.has("x-request-id")) {
				headers.set("x-request-id", String(reqId));
			}
		}

		let body: BodyInit | null = options.body ?? null;
		if (options.json !== undefined) {
			body = JSON.stringify(options.json);
			if (!headers.has("content-type")) {
				headers.set("content-type", "application/json");
			}
		}

		const timeout = options.timeoutMs ?? this.options.timeoutMs ?? 10_000;
		const signal =
			options.signal ??
			(timeout > 0 ? AbortSignal.timeout(timeout) : undefined);

		const reqInit: RequestInit = {
			method: method.toUpperCase(),
			headers,
			signal,
		};

		if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
			reqInit.body = body;
		}

		return new Request(url, reqInit);
	}

	private buildUrl(path: string, query?: QueryParams): string {
		const base = this.options.baseUrl ?? "http://localhost";
		const full =
			path.startsWith("http://") || path.startsWith("https://")
				? path
				: `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;

		const url = new URL(full);
		if (query) {
			for (const [key, value] of Object.entries(query)) {
				if (Array.isArray(value)) {
					for (const item of value) {
						url.searchParams.append(key, String(item));
					}
				} else if (value !== undefined) {
					url.searchParams.set(key, String(value));
				}
			}
		}
		return url.toString();
	}
}

function wrapClientResponse<T = unknown>(res: Response): ClientResponse<T> {
	return Object.assign(res, {
		data: () => res.json() as Promise<T>,
	});
}
