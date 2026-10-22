import { json } from "./http";

export type HeadersInit = NonNullable<ResponseInit["headers"]>;

export class HttpError extends Error {
	readonly status: number;
	readonly body: unknown;
	readonly headers?: HeadersInit;

	constructor(status: number, body?: unknown, headers?: HeadersInit) {
		if (!Number.isInteger(status) || status < 100 || status > 599) {
			throw new Error(
				`Invalid HTTP status code: ${status}. Must be an integer between 100 and 599.`,
			);
		}
		super(typeof body === "string" ? body : `HTTP ${status}`);
		this.name = "HttpError";
		this.status = status;
		this.body = body ?? { error: defaultStatusText(status) };
		if (headers !== undefined) this.headers = headers;
	}
}

function defaultStatusText(status: number): string {
	switch (status) {
		case 400:
			return "Bad Request";
		case 401:
			return "Unauthorized";
		case 403:
			return "Forbidden";
		case 404:
			return "Not Found";
		case 405:
			return "Method Not Allowed";
		case 408:
			return "Request Timeout";
		case 409:
			return "Conflict";
		case 413:
			return "Payload Too Large";
		case 418:
			return "I'm a teapot";
		case 422:
			return "Unprocessable Entity";
		case 429:
			return "Too Many Requests";
		case 500:
			return "Internal Server Error";
		case 502:
			return "Bad Gateway";
		case 503:
			return "Service Unavailable";
		case 504:
			return "Gateway Timeout";
		default:
			return status >= 500 ? "Internal Server Error" : "Error";
	}
}

function safeJson(
	status: number,
	body: unknown,
	headers?: HeadersInit,
): Response {
	try {
		const init: ResponseInit =
			headers !== undefined ? { status, headers } : { status };
		return json(body, init);
	} catch {
		return new Response("Internal Server Error", {
			status: 500,
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	}
}

export function errorToResponse(err: unknown, development: boolean): Response {
	if (err instanceof Response) {
		return err;
	}
	if (err instanceof HttpError) {
		return safeJson(err.status, err.body, err.headers);
	}
	if (development) {
		const message = err instanceof Error ? err.message : String(err);
		const stack = err instanceof Error ? err.stack : undefined;
		return safeJson(500, { error: "Internal Server Error", message, stack });
	}
	return safeJson(500, { error: "Internal Server Error" });
}

export const createErrorResponse = errorToResponse;
