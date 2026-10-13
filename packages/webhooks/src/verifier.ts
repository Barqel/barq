import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "@barqel/barq";
import type { WebhookOptions, WebhookProvider } from "./types";

export class WebhookVerificationError extends Error {
	constructor(
		message: string,
		public readonly code = "WEBHOOK_VERIFICATION_FAILED",
		public readonly status = 400,
	) {
		super(message);
		this.name = "WebhookVerificationError";
	}
}

export function secureCompare(a: string, b: string): boolean {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	if (bufA.length !== bufB.length) return false;
	return timingSafeEqual(bufA, bufB);
}

export async function verifySignature(
	rawBody: string,
	ctx: Context,
	options: WebhookOptions,
): Promise<{ raw: string; payload: unknown; provider: WebhookProvider }> {
	const provider = options.provider ?? "standard";
	const secret =
		typeof options.secret === "function"
			? await options.secret(ctx)
			: options.secret;

	if (!secret) {
		throw new WebhookVerificationError(
			"Webhook signing secret is missing",
			"MISSING_SECRET",
			500,
		);
	}

	if (provider === "custom") {
		if (!options.verify) {
			throw new WebhookVerificationError(
				"Custom provider requires verify function",
				"MISSING_VERIFY_FN",
				500,
			);
		}
		const header = options.headerName
			? ctx.req.headers.get(options.headerName.toLowerCase())
			: null;
		const isValid = await options.verify(rawBody, header ?? "", secret, ctx);
		if (!isValid) {
			throw new WebhookVerificationError(
				"Invalid custom webhook signature",
				"INVALID_SIGNATURE",
				401,
			);
		}
	} else if (provider === "stripe") {
		verifyStripe(rawBody, ctx, secret, options.toleranceSeconds ?? 300);
	} else if (provider === "github") {
		verifyGitHub(rawBody, ctx, secret);
	} else if (provider === "shopify") {
		verifyShopify(rawBody, ctx, secret);
	} else {
		verifyStandard(
			rawBody,
			ctx,
			secret,
			options.headerName ?? "x-signature-256",
		);
	}

	let payload: unknown = rawBody;
	if (options.parseJson !== false) {
		try {
			payload = JSON.parse(rawBody);
		} catch {}
	}

	return { raw: rawBody, payload, provider };
}

function verifyStripe(
	rawBody: string,
	ctx: Context,
	secret: string,
	tolerance: number,
): void {
	const header = ctx.req.headers.get("stripe-signature");
	if (!header) {
		throw new WebhookVerificationError(
			"Missing stripe-signature header",
			"MISSING_HEADER",
			400,
		);
	}

	const parts = header.split(",");
	let timestamp = -1;
	const signatures: string[] = [];

	for (const part of parts) {
		const [k, v] = part.trim().split("=");
		if (k === "t" && v) {
			timestamp = Number.parseInt(v, 10);
		} else if (k === "v1" && v) {
			signatures.push(v);
		}
	}

	if (timestamp === -1 || signatures.length === 0) {
		throw new WebhookVerificationError(
			"Malformed stripe-signature header",
			"MALFORMED_HEADER",
			400,
		);
	}

	const now = Math.floor(Date.now() / 1000);
	if (tolerance > 0 && Math.abs(now - timestamp) > tolerance) {
		throw new WebhookVerificationError(
			"Webhook timestamp outside tolerance range",
			"TIMESTAMP_OUT_OF_RANGE",
			400,
		);
	}

	const payloadToSign = `${timestamp}.${rawBody}`;
	const expected = createHmac("sha256", secret)
		.update(payloadToSign)
		.digest("hex");

	const matches = signatures.some((sig) => secureCompare(sig, expected));
	if (!matches) {
		throw new WebhookVerificationError(
			"No matching signature found for stripe payload",
			"INVALID_SIGNATURE",
			401,
		);
	}
}

function verifyGitHub(rawBody: string, ctx: Context, secret: string): void {
	const header = ctx.req.headers.get("x-hub-signature-256");
	if (!header) {
		throw new WebhookVerificationError(
			"Missing x-hub-signature-256 header",
			"MISSING_HEADER",
			400,
		);
	}

	if (!header.startsWith("sha256=")) {
		throw new WebhookVerificationError(
			"Malformed x-hub-signature-256 header format",
			"MALFORMED_HEADER",
			400,
		);
	}

	const signature = header.slice(7);
	const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

	if (!secureCompare(signature, expected)) {
		throw new WebhookVerificationError(
			"Invalid GitHub webhook signature",
			"INVALID_SIGNATURE",
			401,
		);
	}
}

function verifyShopify(rawBody: string, ctx: Context, secret: string): void {
	const header = ctx.req.headers.get("x-shopify-hmac-sha256");
	if (!header) {
		throw new WebhookVerificationError(
			"Missing x-shopify-hmac-sha256 header",
			"MISSING_HEADER",
			400,
		);
	}

	const expected = createHmac("sha256", secret)
		.update(rawBody, "utf8")
		.digest("base64");

	if (!secureCompare(header, expected)) {
		throw new WebhookVerificationError(
			"Invalid Shopify webhook signature",
			"INVALID_SIGNATURE",
			401,
		);
	}
}

function verifyStandard(
	rawBody: string,
	ctx: Context,
	secret: string,
	headerName: string,
): void {
	const header = ctx.req.headers.get(headerName.toLowerCase());
	if (!header) {
		throw new WebhookVerificationError(
			`Missing ${headerName} header`,
			"MISSING_HEADER",
			400,
		);
	}

	const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

	if (!secureCompare(header, expected)) {
		throw new WebhookVerificationError(
			"Invalid standard HMAC signature",
			"INVALID_SIGNATURE",
			401,
		);
	}
}
