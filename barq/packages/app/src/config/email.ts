// Mail defaults — override through `defineConfig({ email })` or through the
// `MAIL_*` environment variables.
//
// The transport is picked automatically: a configured SMTP host means real
// delivery, no host means the `log` transport — the message is printed in
// the terminal instead of being sent, so a development environment never
// needs a mail server (and can never mail a real inbox by accident).

import type {
	MailAuth,
	MailTlsOptions,
	MailTransport,
} from "@barqel/barq-email";

/** The transports the mail plugin understands, plus the automatic pick. */
export type AppMailTransport = MailTransport | "auto";

/** The mail configuration an application may declare. */
export interface AppEmailConfig {
	/** The transport to deliver through (default: "auto"). */
	transport?: AppMailTransport;
	/** The SMTP host — a host switches the automatic transport to SMTP. */
	host?: string;
	/** The SMTP port (default: 587). */
	port?: number;
	/** TLS from the first byte (default: true on port 465). */
	secure?: boolean;
	/** The SMTP user — an empty user means no authentication. */
	user?: string;
	/** The SMTP password. */
	pass?: string;
	/** The sender address. */
	from?: string;
	/** The sender name — sent as `Name <from>`. */
	fromName?: string;
	/** Where the replies go. */
	replyTo?: string;
	/** A prefix added to every subject, e.g. "[Starter Kit] ". */
	subjectPrefix?: string;
	/** How many times a failed send is retried (default: 2). */
	retries?: number;
	/** The delay before the first retry in milliseconds (default: 500). */
	retryDelay?: number;
	/** Reuse the SMTP connection through a pool (default: false). */
	pool?: boolean;
	/** The socket timeout in milliseconds (default: 10000). */
	timeout?: number;
	/** TLS overrides — `rejectUnauthorized: false` for self-signed dev certs. */
	tls?: MailTlsOptions;
}

/** The mail configuration with every default filled in. */
export interface ResolvedEmailConfig {
	transport: MailTransport;
	host: string;
	port: number;
	secure: boolean;
	auth?: MailAuth;
	from: string;
	fromName: string;
	replyTo?: string;
	subjectPrefix: string;
	pool: boolean;
	timeout: number;
	retries: number;
	retryDelay: number;
	tls?: MailTlsOptions;
}

/** The environment variables the mail configuration reads. */
export interface MailEnv {
	MAIL_TRANSPORT: AppMailTransport;
	MAIL_HOST: string;
	MAIL_PORT: number;
	MAIL_SECURE: boolean;
	MAIL_USER: string;
	MAIL_PASSWORD: string;
	MAIL_FROM: string;
	MAIL_FROM_NAME: string;
	MAIL_REPLY_TO: string;
	MAIL_SUBJECT_PREFIX: string;
	MAIL_RETRIES: number;
	MAIL_RETRY_DELAY: number;
	MAIL_POOL: boolean;
	MAIL_TIMEOUT: number;
}

export const DEFAULT_EMAIL: ResolvedEmailConfig = {
	transport: "log",
	host: "",
	port: 587,
	secure: false,
	from: "barq@example.com",
	fromName: "Barq",
	subjectPrefix: "",
	pool: false,
	timeout: 10_000,
	retries: 2,
	retryDelay: 500,
};

/** Picks the transport — "auto" means SMTP when a host is configured. */
function resolveTransport(
	transport: AppMailTransport,
	host: string,
): MailTransport {
	if (transport === "auto") {
		return host.trim() === "" ? "log" : "smtp";
	}

	return transport;
}

/**
 * Resolves the mail configuration: the application config wins, the
 * environment fills the rest, the defaults fill the rest of that.
 */
export function resolveEmail(
	config: AppEmailConfig = {},
	env: MailEnv,
): ResolvedEmailConfig {
	const host = config.host ?? env.MAIL_HOST;
	const port = config.port ?? env.MAIL_PORT;
	const user = config.user ?? env.MAIL_USER;
	const pass = config.pass ?? env.MAIL_PASSWORD;

	return {
		transport: resolveTransport(config.transport ?? env.MAIL_TRANSPORT, host),
		host,
		port,
		secure: config.secure ?? env.MAIL_SECURE ?? port === 465,
		...(user.trim() === "" ? {} : { auth: { user, pass } }),
		from: config.from ?? env.MAIL_FROM,
		fromName: config.fromName ?? env.MAIL_FROM_NAME,
		...((config.replyTo ?? env.MAIL_REPLY_TO)
			? { replyTo: config.replyTo ?? env.MAIL_REPLY_TO }
			: {}),
		subjectPrefix: config.subjectPrefix ?? env.MAIL_SUBJECT_PREFIX,
		pool: config.pool ?? env.MAIL_POOL,
		timeout: config.timeout ?? env.MAIL_TIMEOUT,
		retries: config.retries ?? env.MAIL_RETRIES,
		retryDelay: config.retryDelay ?? env.MAIL_RETRY_DELAY,
		...(config.tls ? { tls: config.tls } : {}),
	};
}
