import type { Context } from "@barqel/barq";

export type QueryValue = string | number | boolean;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface RetryOptions {
	retries?: number;
	minDelayMs?: number;
	maxDelayMs?: number;
	backoffFactor?: number;
	retryOn?: (error: unknown, response?: Response) => boolean;
}

export interface CircuitBreakerOptions {
	enabled?: boolean;
	failureThreshold?: number;
	recoveryTimeMs?: number;
	halfOpenSuccessThreshold?: number;
}

export interface ClientOptions {
	baseUrl?: string;
	timeoutMs?: number;
	headers?: Record<string, string> | Headers;
	retry?: RetryOptions | false;
	circuitBreaker?: CircuitBreakerOptions | false;
	onRequest?: (req: Request) => void | Promise<void>;
	onResponse?: (res: Response, req: Request) => void | Promise<void>;
}

export interface ClientRequestOptions extends Omit<RequestInit, "body"> {
	query?: QueryParams;
	json?: unknown;
	body?: BodyInit | null;
	timeoutMs?: number;
	retry?: RetryOptions | false;
	ctx?: Context;
}

export type ClientResponse<T = unknown> = Response & {
	data(): Promise<T>;
};
