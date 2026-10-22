import type { Context } from "@barqel/barq";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LogRecord {
	level: LogLevel;
	time: string;
	message?: string;
	requestId?: string;
	method?: string;
	path?: string;
	status?: number;
	durationMs?: number;
	ip?: string;
	userAgent?: string;
	data?: Record<string, unknown>;
	error?: unknown;
}

export interface RequestLogger {
	debug(message: string, data?: Record<string, unknown>): void;
	info(message: string, data?: Record<string, unknown>): void;
	warn(message: string, data?: Record<string, unknown>): void;
	error(message: string, error?: unknown, data?: Record<string, unknown>): void;
}

export interface LoggerOptions {
	level?: LogLevel;
	mode?: "auto" | "json" | "pretty";
	headerName?: string;
	generateId?: () => string;
	skip?: (ctx: Context) => boolean;
	output?: (record: LogRecord, formatted: string) => void;
}
