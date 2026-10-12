export interface SseMessage<T = unknown> {
	id?: string | number;
	event?: string;
	data?: T;
	retry?: number;
	comment?: string;
}

export interface SseOptions {
	heartbeatIntervalMs?: number;
	retry?: number;
	headers?: Record<string, string>;
}

export interface SseEmitter {
	send(data: unknown, options?: Omit<SseMessage, "data">): void;
	send(message: SseMessage): void;
	comment(text: string): void;
	close(): void;
	readonly isClosed: boolean;
	readonly signal?: AbortSignal;
}

export type SseHandler = (emitter: SseEmitter) => void | Promise<void>;
