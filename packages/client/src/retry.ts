import type { RetryOptions } from "./types";

export function defaultRetryOn(error: unknown, response?: Response): boolean {
	if (error !== undefined) {
		return true;
	}
	if (response !== undefined) {
		return response.status >= 500 || response.status === 429;
	}
	return false;
}

export function computeBackoffDelay(
	attempt: number,
	options: RetryOptions,
): number {
	const minDelay = options.minDelayMs ?? 100;
	const maxDelay = options.maxDelayMs ?? 2000;
	const factor = options.backoffFactor ?? 2;

	const exponential = minDelay * Math.pow(factor, attempt);
	const jitter = Math.random() * (minDelay * 0.5);
	return Math.min(maxDelay, exponential + jitter);
}
