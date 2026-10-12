import type { LogLevel, LogRecord } from "./types";

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	silent: 100,
};

export function shouldLog(configured: LogLevel, target: LogLevel): boolean {
	return LEVEL_WEIGHTS[target] >= LEVEL_WEIGHTS[configured];
}

const RESET = "\x1b[0m";
const GRAY = "\x1b[90m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";

function colorizeStatus(status: number): string {
	if (status >= 500) return `${RED}${status}${RESET}`;
	if (status >= 400) return `${YELLOW}${status}${RESET}`;
	if (status >= 300) return `${CYAN}${status}${RESET}`;
	if (status >= 200) return `${GREEN}${status}${RESET}`;
	return `${GRAY}${status}${RESET}`;
}

function colorizeMethod(method: string): string {
	switch (method) {
		case "GET":
			return `${GREEN}GET${RESET}`;
		case "POST":
			return `${BLUE}POST${RESET}`;
		case "PUT":
			return `${YELLOW}PUT${RESET}`;
		case "DELETE":
			return `${RED}DELETE${RESET}`;
		case "PATCH":
			return `${MAGENTA}PATCH${RESET}`;
		default:
			return `${CYAN}${method}${RESET}`;
	}
}

function colorizeLevel(level: LogLevel): string {
	switch (level) {
		case "debug":
			return `${GRAY}DEBUG${RESET}`;
		case "info":
			return `${CYAN}INFO ${RESET}`;
		case "warn":
			return `${YELLOW}WARN ${RESET}`;
		case "error":
			return `${RED}ERROR${RESET}`;
		default:
			return level.toUpperCase();
	}
}

export function formatPretty(record: LogRecord): string {
	const parts: string[] = [`${GRAY}${record.time}${RESET}`, colorizeLevel(record.level)];

	if (record.requestId) {
		parts.push(`${GRAY}(${record.requestId})${RESET}`);
	}

	if (record.method && record.path) {
		parts.push(colorizeMethod(record.method), record.path);
		if (record.status !== undefined) {
			parts.push(colorizeStatus(record.status));
		}
		if (record.durationMs !== undefined) {
			parts.push(`${GRAY}${record.durationMs}ms${RESET}`);
		}
	}

	if (record.message) {
		parts.push(record.message);
	}

	if (record.data && Object.keys(record.data).length > 0) {
		parts.push(`${GRAY}${JSON.stringify(record.data)}${RESET}`);
	}

	if (record.error) {
		const errStr = record.error instanceof Error ? (record.error.stack ?? record.error.message) : String(record.error);
		parts.push(`\n${RED}${errStr}${RESET}`);
	}

	return parts.join(" ");
}

export function formatJson(record: LogRecord): string {
	const out: Record<string, unknown> = {
		level: record.level,
		time: record.time,
		message: record.message,
		requestId: record.requestId,
		method: record.method,
		path: record.path,
		status: record.status,
		durationMs: record.durationMs,
		ip: record.ip,
		userAgent: record.userAgent,
		...record.data,
	};

	if (record.error) {
		out.error =
			record.error instanceof Error
				? {
						message: record.error.message,
						name: record.error.name,
						stack: record.error.stack,
					}
				: record.error;
	}

	return JSON.stringify(out);
}
