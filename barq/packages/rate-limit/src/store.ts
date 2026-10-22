import type { RateLimitStore, StoreIncrementResult } from "./types";

interface MemoryEntry {
	count: number;
	expiresAt: number;
}

export class MemoryStore implements RateLimitStore {
	private readonly hits = new Map<string, MemoryEntry>();
	private sweepInterval: ReturnType<typeof setInterval> | null = null;

	constructor(sweepMs = 30_000) {
		this.sweepInterval = setInterval(() => this.sweep(), sweepMs);
		if (typeof this.sweepInterval.unref === "function") {
			this.sweepInterval.unref();
		}
	}

	increment(key: string, windowMs: number): StoreIncrementResult {
		const now = Date.now();
		let entry = this.hits.get(key);

		if (!entry || entry.expiresAt <= now) {
			entry = { count: 1, expiresAt: now + windowMs };
			this.hits.set(key, entry);
		} else {
			entry.count++;
		}

		const timeToResetMs = Math.max(0, entry.expiresAt - now);
		return {
			totalHits: entry.count,
			timeToResetMs,
			resetTime: Math.ceil(entry.expiresAt / 1000),
		};
	}

	decrement(key: string): void {
		const entry = this.hits.get(key);
		if (entry && entry.count > 0) {
			entry.count--;
		}
	}

	reset(key: string): void {
		this.hits.delete(key);
	}

	clear(): void {
		this.hits.clear();
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
		for (const [key, entry] of this.hits.entries()) {
			if (entry.expiresAt <= now) {
				this.hits.delete(key);
			}
		}
	}
}
