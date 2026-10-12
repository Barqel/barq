import { type Context, HttpError, type Middleware, json } from "@barqel/barq";
import type { WebhookOptions, WebhookPayloadState } from "./types";
import { WebhookVerificationError, verifySignature } from "./verifier";

export function verifyWebhook(options: WebhookOptions): Middleware {
	return {
		async before(ctx: Context) {
			if (ctx.req.method !== "POST" && ctx.req.method !== "PUT") {
				return;
			}

			const rawBody = await ctx.text();

			try {
				const verified = await verifySignature(rawBody, ctx, options);
				const state = ctx.state as Record<string, unknown> & WebhookPayloadState;
				state.webhookRaw = verified.raw;
				state.webhookPayload = verified.payload;
				state.webhookProvider = verified.provider;
			} catch (err) {
				if (options.onInvalidSignature) {
					const res = await options.onInvalidSignature(ctx, err as Error);
					if (res instanceof Response) return res;
				}

				if (err instanceof WebhookVerificationError) {
					throw new HttpError(err.status, {
						error: "Webhook Verification Failed",
						code: err.code,
						message: err.message,
					});
				}

				throw new HttpError(400, {
					error: "Webhook Verification Failed",
					message: err instanceof Error ? err.message : String(err),
				});
			}
		},
	};
}
