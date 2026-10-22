import { describe, expect, it } from "bun:test";
import { createTestApp, defineConfig, type TestServer } from "../src/index";

describe("the mail plugin", () => {
	it("installs the mailer on the app and registers it globally", async () => {
		const server: TestServer = createTestApp(
			defineConfig({ email: { from: "hello@example.com" } }),
		);

		try {
			expect(server.app.mail).toBeDefined();
			expect(server.app.mail.options.from).toBe("hello@example.com");

			// The same instance the framework hands to the application.
			const { mailer } = await import("../src/index");
			expect(mailer()).toBe(server.app.mail);
		} finally {
			await server.close();
		}
	});

	it("logs the messages when no SMTP host is configured", async () => {
		const server = createTestApp(
			defineConfig({ email: { from: "hello@example.com" } }),
		);

		try {
			expect(server.app.mail.options.transport).toBe("log");

			const result = await server.app.mail.send({
				to: "user@example.com",
				subject: "Hello",
				text: "Welcome aboard.",
			});

			expect(result.accepted).toEqual(["user@example.com"]);
			expect(result.transport).toBe("log");
		} finally {
			await server.close();
		}
	});

	it("picks SMTP as soon as a host is configured", async () => {
		const server = createTestApp(
			defineConfig({
				email: { host: "smtp.example.com", from: "hello@example.com" },
			}),
		);

		try {
			expect(server.app.mail.options.transport).toBe("smtp");
			expect(server.app.mail.options.port).toBe(587);
			expect(server.app.mail.options.secure).toBe(false);
		} finally {
			await server.close();
		}
	});
});
