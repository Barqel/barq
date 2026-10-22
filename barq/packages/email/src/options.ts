// The option resolver — fills every default of the mailer, so the rest of
// the plugin never asks "is this set?".

import type { MailOptions, ResolvedMailOptions } from "./types";

const DEFAULT_PORT = 587;
const DEFAULT_MAX_CONNECTIONS = 5;
const DEFAULT_MAX_MESSAGES = 100;
const DEFAULT_TIMEOUT = 10_000;
const DEFAULT_RETRY_DELAY = 500;
const DEFAULT_SENDMAIL_PATH = "sendmail";

/** Fills every default of the mailer options. */
export function resolveMailOptions(
	options: MailOptions = {},
): ResolvedMailOptions {
	const port = options.port ?? DEFAULT_PORT;

	return {
		transport: options.transport ?? "smtp",
		host: options.host ?? "",
		port,
		secure: options.secure ?? port === 465,
		...(options.auth ? { auth: options.auth } : {}),
		...(options.from ? { from: options.from } : {}),
		fromName: options.fromName ?? "",
		...(options.replyTo ? { replyTo: options.replyTo } : {}),
		subjectPrefix: options.subjectPrefix ?? "",
		pool: options.pool ?? false,
		maxConnections: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
		maxMessages: options.maxMessages ?? DEFAULT_MAX_MESSAGES,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
		...(options.tls ? { tls: options.tls } : {}),
		sendmailPath: options.sendmailPath ?? DEFAULT_SENDMAIL_PATH,
		sendmailArgs: options.sendmailArgs ?? [],
		retries: Math.max(0, options.retries ?? 0),
		retryDelay: Math.max(0, options.retryDelay ?? DEFAULT_RETRY_DELAY),
		logBody: options.logBody ?? false,
		...(options.onSent ? { onSent: options.onSent } : {}),
		...(options.onError ? { onError: options.onError } : {}),
	};
}
