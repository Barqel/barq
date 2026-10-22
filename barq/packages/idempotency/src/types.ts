export interface IdempotencyResponse {
	status: number;
	headers: Record<string, string>;
	body: ArrayBuffer;
}

export interface IdempotencyRecord {
	status: "IN_PROGRESS" | "DONE";
	response?: IdempotencyResponse;
	expiresAt: number;
}

export interface IdempotencyStore {
	get(
		key: string,
	): Promise<IdempotencyRecord | undefined> | IdempotencyRecord | undefined;
	set(key: string, record: IdempotencyRecord): Promise<void> | void;
	delete(key: string): Promise<void> | void;
	clear(): Promise<void> | void;
}

export interface IdempotencyOptions {
	headerName?: string;
	ttlMs?: number;
	store?: IdempotencyStore;
	enforceHeader?: boolean;
	errorMessage?: unknown;
	conflictMessage?: unknown;
}
