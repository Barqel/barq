import type { Context } from "@barqel/barq";

export interface CacheEntry {
	body: ArrayBuffer;
	headers: Record<string, string>;
	status: number;
	etag?: string;
	expiresAt: number;
}

export interface CacheStore {
	get(key: string): CacheEntry | undefined | Promise<CacheEntry | undefined>;
	set(key: string, entry: CacheEntry): void | Promise<void>;
	delete(key: string): void | Promise<void>;
	clear(): void | Promise<void>;
}

export interface CacheOptions {
	ttlMs?: number;
	methods?: string[];
	keyGenerator?: (ctx: Context) => string | Promise<string>;
	enableEtag?: boolean;
	cacheControl?: boolean;
	store?: CacheStore;
	skip?: (ctx: Context) => boolean | Promise<boolean>;
}
