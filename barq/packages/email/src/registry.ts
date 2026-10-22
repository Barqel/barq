// The process-wide mailer — the one the plugin registered at boot.
//
// It is the counterpart of `eventBus()` in the app framework: a service,
// a job or a listener can send a mail without being handed the mailer.
//
// The mailer lives on `globalThis` (behind a registered symbol) instead of
// in a module variable: a project that ends up with two copies of this
// package — a bundled one and an installed one, for instance — still shares
// a single mailer, so `setMailer()` and `mailer()` always talk to the same
// instance.

import { MailConfigurationError } from "./errors";
import type { Mailer } from "./mailer";

const MAILER_KEY = Symbol.for("@barqel/barq-email:mailer");

interface MailerGlobal {
	[MAILER_KEY]?: Mailer | null;
}

function scope(): MailerGlobal {
	return globalThis as MailerGlobal;
}

/** Registers the mailer the application uses — called by the plugin. */
export function setMailer(mailer: Mailer | null): void {
	scope()[MAILER_KEY] = mailer;
}

/** `true` when a mailer was registered. */
export function hasMailer(): boolean {
	return scope()[MAILER_KEY] !== undefined && scope()[MAILER_KEY] !== null;
}

/** The registered mailer — throws when the plugin never ran. */
export function mailer(): Mailer {
	const current = scope()[MAILER_KEY];

	if (!current) {
		throw new MailConfigurationError(
			"The mailer is not initialized — register `emailPlugin()` at boot.",
		);
	}

	return current;
}
