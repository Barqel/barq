// The transport factory — turns the resolved options into a nodemailer
// transporter.
//
// - `smtp`     — a real SMTP server (the default)
// - `log`      — writes the message to the console instead of sending it
// - `json`     — returns the message as JSON, never touches the network
// - `stream`   — hands the raw MIME over — the transport used by tests
// - `sendmail` — pipes the message into the local sendmail binary

import type {
	SentMessageInfo,
	SMTPPoolOptions,
	SMTPTransportOptions,
	Transport,
	Transporter,
} from "nodemailer";
import { createTransport } from "nodemailer";
import { flattenAddresses } from "./address";
import type { ResolvedMailOptions } from "./types";

/**
 * The `log` transport — delivers nothing, prints the message instead.
 *
 * It is the transport a development environment runs on: the mail is
 * visible in the terminal, no server is needed and no mail can ever reach
 * a real inbox by accident.
 */
function createLogTransport(
	options: ResolvedMailOptions,
): Transport<SentMessageInfo> {
	return {
		name: "log",
		version: "1.0.0",
		send(mail, callback) {
			const data = mail.data ?? {};
			const envelope = mail.message.getEnvelope();
			const to = envelope.to ?? flattenAddresses(data.to);
			const subject = String(data.subject ?? "(no subject)");

			mail.message
				.build()
				.then((raw) => {
					console.info(
						`[mail] to=${to.join(", ")} subject="${subject}" (logged, not sent)`,
					);

					if (options.logBody) {
						console.info(raw.toString("utf8"));
					}

					callback(null, {
						messageId: mail.message.messageId(),
						accepted: to,
						rejected: [],
						response: "250 Message logged",
						envelope: {
							from: envelope.from ?? "",
							to,
						},
						message: raw,
					});
				})
				.catch((error: unknown) => {
					callback(error as Error, undefined as unknown as SentMessageInfo);
				});
		},
	};
}

/** Builds the transporter of the resolved options. */
export function createMailTransport(options: ResolvedMailOptions): Transporter {
	switch (options.transport) {
		case "log":
			return createTransport(
				createLogTransport(options),
			) as unknown as Transporter;

		case "json":
			return createTransport({ jsonTransport: true }) as Transporter;

		case "stream":
			return createTransport({
				streamTransport: true,
				buffer: true,
				newline: "unix",
			}) as Transporter;

		case "sendmail":
			return createTransport({
				sendmail: true,
				path: options.sendmailPath,
				args: options.sendmailArgs,
			}) as Transporter;

		default: {
			// nodemailer splits the timeout into the connection and the socket
			// phase — the plugin keeps one knob and fills both.
			const smtpOptions: SMTPTransportOptions & SMTPPoolOptions = {
				host: options.host,
				port: options.port,
				secure: options.secure,
				...(options.auth
					? { auth: { user: options.auth.user, pass: options.auth.pass } }
					: {}),
				pool: options.pool,
				maxConnections: options.maxConnections,
				maxMessages: options.maxMessages,
				connectionTimeout: options.timeout,
				socketTimeout: options.timeout,
				...(options.tls ? { tls: options.tls } : {}),
			};

			return createTransport(smtpOptions) as unknown as Transporter;
		}
	}
}
