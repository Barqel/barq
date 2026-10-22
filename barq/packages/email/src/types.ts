// The types of the mail plugin.
//
// The message shape is deliberately narrower than nodemailer's
// `SendMailOptions`: the plugin adds the template layer, the defaults and
// the retries, so an application only writes what it means.

import type {
	Attachment,
	AttachmentLike,
	SentMessageInfo,
	Transporter,
} from "nodemailer";
import type { MailAddress } from "./address";

/** The transport backends the plugin ships with. */
export type MailTransport = "smtp" | "log" | "json" | "stream" | "sendmail";

/** SMTP credentials. */
export interface MailAuth {
	user: string;
	pass: string;
}

/** TLS overrides — `rejectUnauthorized: false` for self-signed dev certs. */
export interface MailTlsOptions {
	rejectUnauthorized?: boolean;
	servername?: string;
}

/** A file attached to the message. */
export type MailAttachment = Attachment;

/** An alternative body (a calendar invite, a JSON feed, …). */
export type MailAlternative = AttachmentLike;

/** A calendar invite attached to the message. */
export interface MailIcalEvent {
	method?: string;
	content?: string | Buffer;
	contentType?: string;
	filename?: string;
}

/**
 * The template of a message — the placeholders (`{{ name }}`) are filled
 * from the `data` of the message.
 */
export interface MailTemplate {
	subject: string;
	html: string;
	text?: string;
}

/** Everything an application writes to send an email. */
export interface MailMessage {
	/** Recipients — required. */
	to: MailAddress;
	/** Carbon copy recipients. */
	cc?: MailAddress;
	/** Blind carbon copy recipients. */
	bcc?: MailAddress;
	/** Where the replies go — overrides the default one. */
	replyTo?: MailAddress;
	/** The sender of this message — overrides the default one. */
	from?: string;
	/** The subject line. */
	subject?: string;
	/** The HTML body. */
	html?: string;
	/** The plain text body. */
	text?: string;
	/** A template — its placeholders are filled from `data`. */
	template?: MailTemplate;
	/** The values of the template placeholders. */
	data?: Record<string, unknown>;
	/** Files attached to the message. */
	attachments?: MailAttachment[];
	/** Alternative bodies — sent next to the HTML one. */
	alternatives?: MailAlternative[];
	/** A calendar invite attached to the message. */
	icalEvent?: MailIcalEvent;
	/** Extra headers. */
	headers?: Record<string, string>;
	/** The priority of the message. */
	priority?: "high" | "normal" | "low";
	/** Overrides the SMTP envelope — the bounce address and the real recipients. */
	envelope?: { from?: string; to?: string[] };
	/** Free-form tags, echoed in the result — handy in logs. */
	tags?: string[];
}

/** What every send returns. */
export interface MailSendResult {
	/** The `Message-ID` of the delivered message. */
	messageId: string;
	/** The recipients the server accepted. */
	accepted: string[];
	/** The recipients the server refused. */
	rejected: string[];
	/** The last response of the server. */
	response: string;
	/** The envelope the message was sent with. */
	envelope: { from: string; to: string[] };
	/** The transport that delivered the message. */
	transport: MailTransport;
	/** How long the delivery took, in milliseconds. */
	durationMs: number;
	/** The rendered message — what actually went out. */
	message: {
		from: string;
		to: string[];
		subject: string;
		text?: string;
		html?: string;
	};
	/** The raw output of the transport — the MIME buffer, the JSON, … */
	raw?: unknown;
	/** The tags of the message. */
	tags: string[];
}

/** How the mailer is set up. */
export interface MailOptions {
	/** The transport to deliver through (default: "smtp"). */
	transport?: MailTransport;
	/** The SMTP host — required by the "smtp" transport. */
	host?: string;
	/** The SMTP port (default: 587). */
	port?: number;
	/** TLS from the first byte (default: true on port 465). */
	secure?: boolean;
	/** The SMTP credentials — no authentication when omitted. */
	auth?: MailAuth;
	/** The default sender address. */
	from?: string;
	/** The default sender name — sent as `Name <from>`. */
	fromName?: string;
	/** The default reply-to address. */
	replyTo?: string;
	/** A prefix added to every subject, e.g. "[Starter Kit] ". */
	subjectPrefix?: string;
	/** Reuse the SMTP connection through a pool (default: false). */
	pool?: boolean;
	/** The maximum number of pooled connections. */
	maxConnections?: number;
	/** The maximum number of messages per pooled connection. */
	maxMessages?: number;
	/** The socket timeout in milliseconds. */
	timeout?: number;
	/** TLS overrides. */
	tls?: MailTlsOptions;
	/** The path of the sendmail binary (transport: "sendmail"). */
	sendmailPath?: string;
	/** The arguments of the sendmail binary (transport: "sendmail"). */
	sendmailArgs?: string[];
	/** How many times a failed send is retried (default: 0). */
	retries?: number;
	/** The delay before the first retry in milliseconds (doubles every attempt). */
	retryDelay?: number;
	/** Print the body of the logged messages too (transport: "log"). */
	logBody?: boolean;
	/** Called after every successful send. */
	onSent?: (result: MailSendResult) => void;
	/** Called when a send failed, after every retry. */
	onError?: (error: Error, message: MailMessage) => void;
	/** Bring your own transporter — the plugin stops building one. */
	transporter?: Transporter;
}

/** The mailer options with every default filled in. */
export interface ResolvedMailOptions {
	transport: MailTransport;
	host: string;
	port: number;
	secure: boolean;
	auth?: MailAuth;
	from?: string;
	fromName: string;
	replyTo?: string;
	subjectPrefix: string;
	pool: boolean;
	maxConnections: number;
	maxMessages: number;
	timeout: number;
	tls?: MailTlsOptions;
	sendmailPath: string;
	sendmailArgs: string[];
	retries: number;
	retryDelay: number;
	logBody: boolean;
	onSent?: (result: MailSendResult) => void;
	onError?: (error: Error, message: MailMessage) => void;
}

/** The result nodemailer hands back — re-exported for the custom transports. */
export type { SentMessageInfo, Transporter };
