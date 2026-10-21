// The error family of the mail plugin.
//
// Every failure the mailer raises is one of these, so a caller can always
// tell a bad configuration from a bad message from a delivery that never
// made it to the server — without reading the message text.

export class MailError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "MailError";
	}
}

/** The mailer is not configured well enough to send (no sender, unknown transport…). */
export class MailConfigurationError extends MailError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "MailConfigurationError";
	}
}

/** The message itself is wrong (no recipient, no subject, no body…). */
export class MailValidationError extends MailError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "MailValidationError";
	}
}

/** A template placeholder has no value (only thrown in strict mode). */
export class MailTemplateError extends MailError {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "MailTemplateError";
	}
}

/**
 * The message could not be delivered — the server refused it or the
 * connection failed. Carries the number of attempts and the original error.
 */
export class MailDeliveryError extends MailError {
	/** How many delivery attempts were made before giving up. */
	readonly attempts: number;

	constructor(
		message: string,
		attempts: number,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = "MailDeliveryError";
		this.attempts = attempts;
	}
}
