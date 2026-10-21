import { describe, expect, it } from "bun:test";
import { createTransport, type Transport } from "nodemailer";
import {
	MailConfigurationError,
	MailDeliveryError,
	Mailer,
	MailTemplateError,
	MailValidationError,
	renderTemplate,
	renderTemplateMessage,
} from "../src/index";

describe("@barqel/barq-email", () => {
	describe("templates", () => {
		it("fills the placeholders from the data", () => {
			expect(renderTemplate("Hi {{ name }}!", { name: "Hassan" })).toBe(
				"Hi Hassan!",
			);
		});

		it("reads dotted paths", () => {
			expect(
				renderTemplate("{{ user.name }} <{{ user.email }}>", {
					user: { name: "Hassan", email: "hassan@example.com" },
				}),
			).toBe("Hassan <hassan@example.com>");
		});

		it("renders an unknown placeholder empty", () => {
			expect(renderTemplate("Hi {{ name }}", {})).toBe("Hi ");
		});

		it("throws in strict mode", () => {
			expect(() =>
				renderTemplate("Hi {{ name }}", {}, { strict: true }),
			).toThrow(MailTemplateError);
		});

		it("escapes the values of an HTML body, never the template", () => {
			const rendered = renderTemplateMessage(
				{
					subject: "Welcome {{ name }}",
					html: "<p>Hello {{ name }}</p>",
				},
				{ name: "<script>alert(1)</script>" },
			);

			expect(rendered.subject).toBe("Welcome <script>alert(1)</script>");
			expect(rendered.html).toBe(
				"<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;</p>",
			);
		});
	});

	describe("the mailer", () => {
		it("sends a message through the log transport", async () => {
			const mailer = new Mailer({
				transport: "log",
				from: "hello@example.com",
			});

			const result = await mailer.send({
				to: "user@example.com",
				subject: "Hello",
				text: "Welcome aboard.",
			});

			expect(result.accepted).toEqual(["user@example.com"]);
			expect(result.message.subject).toBe("Hello");
			expect(result.message.text).toBe("Welcome aboard.");
			expect(result.transport).toBe("log");
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
		});

		it("renders the template and applies the defaults", async () => {
			const mailer = new Mailer({
				transport: "json",
				from: "hello@example.com",
				fromName: "Barq",
				subjectPrefix: "[Starter]",
			});

			const result = await mailer.send({
				to: "user@example.com",
				template: {
					subject: "Welcome {{ name }}",
					html: "<p>Hello {{ name }}</p>",
				},
				data: { name: "Hassan" },
			});

			expect(result.message.from).toBe("Barq <hello@example.com>");
			expect(result.message.subject).toBe("[Starter] Welcome Hassan");
			expect(result.message.html).toBe("<p>Hello Hassan</p>");
		});

		it("hands the raw MIME over with the stream transport", async () => {
			const mailer = new Mailer({
				transport: "stream",
				from: "hello@example.com",
			});

			const result = await mailer.send({
				to: "user@example.com",
				subject: "Hello",
				text: "Welcome aboard.",
			});

			const raw = result.raw as Buffer;
			expect(raw.toString("utf8")).toContain("Subject: Hello");
			expect(raw.toString("utf8")).toContain("Welcome aboard.");
		});

		it("refuses a message without a recipient", async () => {
			const mailer = new Mailer({
				transport: "log",
				from: "hello@example.com",
			});

			await expect(
				mailer.send({ to: [], subject: "Hello", text: "…" }),
			).rejects.toThrow(MailValidationError);
		});

		it("refuses a message without a sender", async () => {
			const mailer = new Mailer({ transport: "log" });

			await expect(
				mailer.send({ to: "user@example.com", subject: "Hello", text: "…" }),
			).rejects.toThrow(MailConfigurationError);
		});

		it("retries a failed delivery and gives up with the attempt count", async () => {
			let attempts = 0;

			const failing: Transport = {
				name: "broken",
				version: "1.0.0",
				send(_mail, callback) {
					attempts++;
					callback(new Error("nope") as never, undefined as never);
				},
			};

			const mailer = new Mailer({
				transport: "log",
				from: "hello@example.com",
				retries: 2,
				retryDelay: 1,
				transporter: createTransport(failing),
			});

			await expect(
				mailer.send({ to: "user@example.com", subject: "Hi", text: "…" }),
			).rejects.toThrow(MailDeliveryError);

			expect(attempts).toBe(3);
		});

		it("calls the onSent hook with the result", async () => {
			let sent = 0;

			const mailer = new Mailer({
				transport: "log",
				from: "hello@example.com",
				onSent: () => {
					sent++;
				},
			});

			await mailer.send({
				to: "user@example.com",
				subject: "Hi",
				text: "…",
				tags: ["welcome"],
			});

			expect(sent).toBe(1);
		});
	});
});
