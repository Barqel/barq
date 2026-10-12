import type { App } from "@barqel/barq";
import { parseSetCookieHeaders } from "./cookies";
import type { ParsedSetCookie, QueryParams, TestClientOptions, TestRequestOptions, TestResponse } from "./types";

export class TestClient {
	private readonly app: App<any>;
	private readonly options: TestClientOptions;

	constructor(app: App<any>, options: TestClientOptions = {}) {
		this.app = app;
		this.options = {
			baseUrl: "http://localhost",
			defaultIp: "127.0.0.1",
			...options,
		};
	}

	get(path: string, options?: TestRequestOptions): Promise<TestResponse> {
		return this.request("GET", path, options);
	}

	post(path: string, options?: TestRequestOptions): Promise<TestResponse> {
		return this.request("POST", path, options);
	}

	put(path: string, options?: TestRequestOptions): Promise<TestResponse> {
		return this.request("PUT", path, options);
	}

	delete(path: string, options?: TestRequestOptions): Promise<TestResponse> {
		return this.request("DELETE", path, options);
	}

	patch(path: string, options?: TestRequestOptions): Promise<TestResponse> {
		return this.request("PATCH", path, options);
	}

	head(path: string, options?: TestRequestOptions): Promise<TestResponse> {
		return this.request("HEAD", path, options);
	}

	options(path: string, options?: TestRequestOptions): Promise<TestResponse> {
		return this.request("OPTIONS", path, options);
	}

	async request(method: string, path: string, options: TestRequestOptions = {}): Promise<TestResponse> {
		const url = this.buildUrl(path, options.query);
		const headers = new Headers(this.options.defaultHeaders);

		if (options.headers) {
			if (options.headers instanceof Headers) {
				options.headers.forEach((v, k) => headers.set(k, v));
			} else {
				for (const [k, v] of Object.entries(options.headers)) {
					headers.set(k, v);
				}
			}
		}

		if (options.cookies) {
			const cookiePairs = Object.entries(options.cookies).map(
				([k, v]) => `${k}=${encodeURIComponent(v)}`,
			);
			headers.set("cookie", cookiePairs.join("; "));
		}

		let body: BodyInit | null = options.body ?? null;

		if (options.json !== undefined) {
			body = JSON.stringify(options.json);
			if (!headers.has("content-type")) {
				headers.set("content-type", "application/json");
			}
		}

		const reqInit: RequestInit = {
			method: method.toUpperCase(),
			headers,
		};

		if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
			reqInit.body = body;
		}

		const request = new Request(url, reqInit);
		const ipAddress = options.ip ?? this.options.defaultIp ?? "127.0.0.1";

		const serverShim: any = {
			port: 0,
			hostname: "localhost",
			development: false,
			requestIP: () => ({ address: ipAddress }),
			upgrade: () => false,
			timeout: () => {},
			stop: async () => {},
			reload: () => {},
		};

		const rawResponse = await (this.app as any).handle(request, serverShim);
		return wrapTestResponse(rawResponse);
	}

	private buildUrl(path: string, query?: QueryParams): string {
		const base = this.options.baseUrl ?? "http://localhost";
		const full = path.startsWith("http://") || path.startsWith("https://")
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

function wrapTestResponse(res: Response): TestResponse {
	let cookiesMap: Map<string, ParsedSetCookie> | undefined;

	return new Proxy(res as TestResponse, {
		get(target, prop, receiver) {
			if (prop === "cookies") {
				if (!cookiesMap) {
					cookiesMap = parseSetCookieHeaders(target.headers);
				}
				return cookiesMap;
			}
			if (prop === "header") {
				return (name: string) => target.headers.get(name);
			}
			const val = Reflect.get(target, prop, target);
			return typeof val === "function" ? val.bind(target) : val;
		},
	});
}
