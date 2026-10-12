import type { Context } from "@barqel/barq";

export interface RateLimitInfo {
	limit: number;
	current: number;
	remaining: number;
	resetTime: number;
	retryAfter: number;
}

export interface StoreIncrementResult {
	totalHits: number;
	timeToResetMs: number;
	resetTime: number;
}

export interface RateLimitStore {
	increment(key: string, windowMs: number): Promise<StoreIncrementResult> | StoreIncrementResult;
	decrement?(key: string): Promise<void> | void;
	reset(key: string): Promise<void> | void;
	clear(): Promise<void> | void;
}

export interface RateLimitOptions {
	windowMs?: number;
	max?: number | ((ctx: Context) => number | Promise<number>);
	keyGenerator?: (ctx: Context) => string | Promise<string>;
	skip?: (ctx: Context) => boolean | Promise<boolean>;
	standardHeaders?: boolean;
	legacyHeaders?: boolean;
	statusCode?: number;
	message?: unknown;
	store?: RateLimitStore;
	onRateLimit?: (ctx: Context, info: RateLimitInfo) => Response | Promise<Response>;
}
