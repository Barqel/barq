import type { IdempotencyRecord, IdempotencyStore } from "./types";

export class MemoryIdempotencyStore implements IdempotencyStore {
	private readonly records = new Map<string, IdempotencyRecord>();
	private sweepInterval: ReturnType<typeof setInterval> | null = null;

	constructor(sweepMs = 60_000) {
		this.sweepInterval = setInterval(() => this.sweep(), sweepMs);
		if (typeof this.sweepInterval.unref === "function") {
			this.sweepInterval.unref();
		}
	}

	get(key: string): IdempotencyRecord | undefined {
		const record = this.records.get(key);
		if (!record) return undefined;
		if (Date.now() > record.expiresAt) {
			this.records.delete(key);
			return undefined;
		}
		return record;
	}

	set(key: string, record: IdempotencyRecord): void {
		this.records.set(key, record);
	}

	delete(key: string): void {
		this.records.delete(key);
	}

	clear(): void {
		this.records.clear();
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
		for (const [key, record] of this.records.entries()) {
			if (record.expiresAt <= now) {
				this.records.delete(key);
			}
		}
	}
}
