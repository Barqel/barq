// The mailer — the one object an application talks to.
//
//   const mailer = new Mailer({ from: "hello@example.com" });
//   await mailer.send({ to: "user@example.com", subject: "Hi", text: "…" });
//
// It owns the defaults, renders the templates, retries the failures and
// hands back one result object that says what happened.

import type { SendMailOptions } from "nodemailer";
import { flattenAddresses, formatAddress, type MailAddress } from "./address";
import {
	MailConfigurationError,
	MailDeliveryError,
	MailValidationError,
} from "./errors";
import { resolveMailOptions } from "./options";
import { renderTemplateMessage } from "./template";
import { createMailTransport } from "./transport";
import type {
	MailMessage,
	MailOptions,
	MailSendResult,
	ResolvedMailOptions,
} from "./types";

/** Waits for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Mailer {
	/** The options with every default filled in. */
	readonly options: ResolvedMailOptions;

	/** The nodemailer transporter the messages go through. */
	readonly transporter: import("nodemailer").Transporter;

	constructor(options: MailOptions = {}) {
		this.options = resolveMailOptions(options);
		this.transporter = options.transporter ?? createMailTransport(this.options);
	}

	/**
	 * Sends a message.
	 *
	 * The template (when there is one) is rendered first, the defaults are
	 * applied, and a failed delivery is retried `retries` times with a
	 * growing delay before it is given up on.
	 */
	async send(message: MailMessage): Promise<MailSendResult> {
		const prepared = this.prepare(message);
		const attempts = this.options.retries + 1;
		let failure: unknown;

		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				const result = await this.deliver(prepared, message);
				this.options.onSent?.(result);
				return result;
			} catch (error) {
				failure = error;

				if (attempt < attempts) {
					await sleep(this.options.retryDelay * 2 ** (attempt - 1));
				}
			}
		}

		const error = new MailDeliveryError(
			`Could not deliver the email to ${flattenAddresses(prepared.to).join(", ")} after ${attempts} attempt(s)`,
			attempts,
			{ cause: failure },
		);

		this.options.onError?.(error, message);

		throw error;
	}

	/** Sends an HTML message — the shortcut for the most common case. */
	async sendHtml(
		to: MailAddress,
		html: string,
		options: Partial<Omit<MailMessage, "to" | "html">> = {},
	): Promise<MailSendResult> {
		return this.send({ ...options, to, html });
	}

	/** Sends a plain text message. */
	async sendText(
		to: MailAddress,
		text: string,
		options: Partial<Omit<MailMessage, "to" | "text">> = {},
	): Promise<MailSendResult> {
		return this.send({ ...options, to, text });
	}

	/**
	 * Checks the transport — the SMTP server answers, the credentials are
	 * right. Throws a `MailDeliveryError` when it does not.
	 */
	async verify(): Promise<boolean> {
		try {
			await this.transporter.verify();
			return true;
		} catch (error) {
			throw new MailDeliveryError("The mail transport is not ready", 1, {
				cause: error,
			});
		}
	}

	/** Closes the transport — releases the pooled SMTP connections. */
	close(): void {
		this.transporter.close();
	}

	/** Turns the message into what nodemailer expects, with every default applied. */
	private prepare(message: MailMessage): SendMailOptions {
		const to = message.to;

		if (!to || (Array.isArray(to) && to.length === 0)) {
			throw new MailValidationError(
				"The email needs at least one recipient (`to`).",
			);
		}

		const rendered = message.template
			? renderTemplateMessage(message.template, message.data ?? {})
			: undefined;

		const subject = rendered?.subject ?? message.subject;
		const html = rendered?.html ?? message.html;
		const text = rendered?.text ?? message.text;

		if (!subject && !html && !text) {
			throw new MailValidationError(
				"The email needs a subject, a body or a template.",
			);
		}

		const from = message.from ?? this.options.from;

		if (!from) {
			throw new MailConfigurationError(
				"No sender address — set `from` in the mail options or on the message.",
			);
		}

		const replyTo = message.replyTo ?? this.options.replyTo;
		const prefixed = this.options.subjectPrefix
			? `${this.options.subjectPrefix}${subject ? ` ${subject}` : ""}`
			: subject;

		return {
			from: message.from ?? formatAddress(this.options.fromName, from),
			to,
			...(message.cc ? { cc: message.cc } : {}),
			...(message.bcc ? { bcc: message.bcc } : {}),
			...(replyTo ? { replyTo } : {}),
			...(prefixed ? { subject: prefixed } : {}),
			...(html ? { html } : {}),
			...(text ? { text } : {}),
			...(message.attachments ? { attachments: message.attachments } : {}),
			...(message.alternatives ? { alternatives: message.alternatives } : {}),
			...(message.icalEvent ? { icalEvent: message.icalEvent } : {}),
			...(message.headers ? { headers: message.headers } : {}),
			...(message.priority ? { priority: message.priority } : {}),
			...(message.envelope ? { envelope: message.envelope } : {}),
		};
	}

	/** Hands the prepared message to the transport. */
	private async deliver(
		prepared: SendMailOptions,
		message: MailMessage,
	): Promise<MailSendResult> {
		const started = Date.now();
		const info = await this.transporter.sendMail(prepared);

		return {
			messageId: info.messageId ?? "",
			accepted: info.accepted ?? [],
			rejected: info.rejected ?? [],
			response: info.response ?? "",
			envelope: {
				from: String(info.envelope?.from ?? prepared.from ?? ""),
				to: info.envelope?.to ?? flattenAddresses(prepared.to),
			},
			transport: this.options.transport,
			durationMs: Date.now() - started,
			message: {
				from: String(prepared.from ?? ""),
				to: flattenAddresses(prepared.to),
				subject: String(prepared.subject ?? ""),
				...(typeof prepared.text === "string" ? { text: prepared.text } : {}),
				...(typeof prepared.html === "string" ? { html: prepared.html } : {}),
			},
			...(info.message === undefined ? {} : { raw: info.message }),
			tags: message.tags ?? [],
		};
	}
}

/** Creates a mailer — the functional shortcut of `new Mailer(…)`. */
export function createMailer(options: MailOptions = {}): Mailer {
	return new Mailer(options);
}
