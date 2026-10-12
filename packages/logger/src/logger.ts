import { randomUUID } from "node:crypto";
import { formatJson, formatPretty, shouldLog } from "./format";
import type { LogLevel, LogRecord, LoggerOptions, RequestLogger } from "./types";

export class Logger {
	readonly level: LogLevel;
	readonly mode: "json" | "pretty";
	readonly outputFn?: (record: LogRecord, formatted: string) => void;

	constructor(options: LoggerOptions = {}) {
		this.level = options.level ?? "info";

		if (options.mode) {
			this.mode = options.mode === "auto" ? (process.env.NODE_ENV === "production" ? "json" : "pretty") : options.mode;
		} else {
			this.mode = process.env.NODE_ENV === "production" ? "json" : "pretty";
		}

		this.outputFn = options.output;
	}

	log(record: LogRecord): void {
		if (!shouldLog(this.level, record.level)) return;

		const formatted = this.mode === "json" ? formatJson(record) : formatPretty(record);

		if (this.outputFn) {
			this.outputFn(record, formatted);
			return;
		}

		if (record.level === "error") {
			console.error(formatted);
		} else if (record.level === "warn") {
			console.warn(formatted);
		} else {
			console.log(formatted);
		}
	}

	createRequestLogger(requestId: string): RequestLogger {
		const emit = (level: LogLevel, message: string, data?: Record<string, unknown>, error?: unknown) => {
			this.log({
				level,
				time: new Date().toISOString(),
				message,
				requestId,
				data,
				error,
			});
		};

		return {
			debug: (msg, data) => emit("debug", msg, data),
			info: (msg, data) => emit("info", msg, data),
			warn: (msg, data) => emit("warn", msg, data),
			error: (msg, err, data) => emit("error", msg, data, err),
		};
	}
}

export function defaultGenerateId(): string {
	return randomUUID();
}
