// The Barq plugin — installs the mailer on the app.
//
//   app.plugin(emailPlugin({ from: "hello@example.com" }));
//   await app.mail.send({ to: "user@example.com", subject: "Hi", text: "…" });
//
// The mailer is also registered as the process-wide one, so a service, a
// job or a listener can reach it through `mailer()`.

import type { App } from "@barqel/barq";
import { Mailer } from "./mailer";
import { setMailer } from "./registry";
import type { MailOptions } from "./types";

/** Registers the mailer — `app.mail` and the process-wide `mailer()`. */
export function emailPlugin(options: MailOptions = {}) {
	const mailer = new Mailer(options);

	return (app: App<any>) => {
		(app as any).mail = mailer;
		setMailer(mailer);
	};
}
