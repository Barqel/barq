import { createHmac } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { verifyWebhook } from "../src/index";

describe("@barqel/barq-webhooks", () => {
	const secret = "whsec_test_secret_123456789";

	it("verifies Stripe signatures with valid timestamp", async () => {
		const app = new App();
		app.post(
			"/webhooks/stripe",
			verifyWebhook({ provider: "stripe", secret }),
			(ctx) => json({ received: true, payload: ctx.state.webhookPayload }),
		);

		const server = app.listen(0);

		try {
			const payload = JSON.stringify({
				id: "evt_123",
				type: "payment_intent.succeeded",
			});
			const timestamp = Math.floor(Date.now() / 1000);
			const sig = createHmac("sha256", secret)
				.update(`${timestamp}.${payload}`)
				.digest("hex");

			const res = await fetch(
				`http://localhost:${server.port}/webhooks/stripe`,
				{
					method: "POST",
					headers: {
						"stripe-signature": `t=${timestamp},v1=${sig}`,
						"content-type": "application/json",
					},
					body: payload,
				},
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.received).toBe(true);
			expect(data.payload.id).toBe("evt_123");
		} finally {
			await app.stop();
		}
	});

	it("rejects Stripe webhook outside tolerance window", async () => {
		const app = new App();
		app.post(
			"/webhooks/stripe-old",
			verifyWebhook({ provider: "stripe", secret, toleranceSeconds: 60 }),
			() => json({ ok: true }),
		);

		const server = app.listen(0);

		try {
			const payload = JSON.stringify({ id: "evt_old" });
			const timestamp = Math.floor(Date.now() / 1000) - 120;
			const sig = createHmac("sha256", secret)
				.update(`${timestamp}.${payload}`)
				.digest("hex");

			const res = await fetch(
				`http://localhost:${server.port}/webhooks/stripe-old`,
				{
					method: "POST",
					headers: {
						"stripe-signature": `t=${timestamp},v1=${sig}`,
					},
					body: payload,
				},
			);

			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.code).toBe("TIMESTAMP_OUT_OF_RANGE");
		} finally {
			await app.stop();
		}
	});

	it("verifies GitHub x-hub-signature-256", async () => {
		const app = new App();
		app.post(
			"/webhooks/github",
			verifyWebhook({ provider: "github", secret }),
			(ctx) => json({ action: (ctx.state.webhookPayload as any).action }),
		);

		const server = app.listen(0);

		try {
			const payload = JSON.stringify({
				action: "opened",
				repository: { name: "barq" },
			});
			const sig = createHmac("sha256", secret).update(payload).digest("hex");

			const res = await fetch(
				`http://localhost:${server.port}/webhooks/github`,
				{
					method: "POST",
					headers: {
						"x-hub-signature-256": `sha256=${sig}`,
						"content-type": "application/json",
					},
					body: payload,
				},
			);

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.action).toBe("opened");
		} finally {
			await app.stop();
		}
	});

	it("verifies Shopify base64 HMAC signature", async () => {
		const app = new App();
		app.post(
			"/webhooks/shopify",
			verifyWebhook({ provider: "shopify", secret }),
			() => json({ success: true }),
		);

		const server = app.listen(0);

		try {
			const payload = JSON.stringify({ order_id: 1001 });
			const sig = createHmac("sha256", secret)
				.update(payload, "utf8")
				.digest("base64");

			const res = await fetch(
				`http://localhost:${server.port}/webhooks/shopify`,
				{
					method: "POST",
					headers: {
						"x-shopify-hmac-sha256": sig,
						"content-type": "application/json",
					},
					body: payload,
				},
			);

			expect(res.status).toBe(200);
		} finally {
			await app.stop();
		}
	});

	it("rejects tampered webhook payloads", async () => {
		const app = new App();
		app.post(
			"/webhooks/verify",
			verifyWebhook({ provider: "standard", secret }),
			() => json({ ok: true }),
		);

		const server = app.listen(0);

		try {
			const payload = JSON.stringify({ amount: 100 });
			const sig = createHmac("sha256", secret).update(payload).digest("hex");

			const res = await fetch(
				`http://localhost:${server.port}/webhooks/verify`,
				{
					method: "POST",
					headers: {
						"x-signature-256": sig,
					},
					body: JSON.stringify({ amount: 500 }),
				},
			);

			expect(res.status).toBe(401);
		} finally {
			await app.stop();
		}
	});
});
