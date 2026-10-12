import type { CacheEntry, CacheStore } from "./types";

export class MemoryCacheStore implements CacheStore {
	private readonly cache = new Map<string, CacheEntry>();
	private sweepInterval: ReturnType<typeof setInterval> | null = null;

	constructor(sweepMs = 60_000) {
		this.sweepInterval = setInterval(() => this.sweep(), sweepMs);
		if (typeof this.sweepInterval.unref === "function") {
			this.sweepInterval.unref();
		}
	}

	get(key: string): CacheEntry | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;

		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key);
			return undefined;
		}

		return entry;
	}

	set(key: string, entry: CacheEntry): void {
		this.cache.set(key, entry);
	}

	delete(key: string): void {
		this.cache.delete(key);
	}

	clear(): void {
		this.cache.clear();
	}

	destroy(): void {
		if (this.sweepInterval) {
			clearInterval(this.sweepInterval);
			this.sweepInterval = null;
		}
		this.clear();
	}

	private sweep(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache.entries()) {
			if (entry.expiresAt <= now) {
				this.cache.delete(key);
			}
		}
	}
}
