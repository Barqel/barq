import type { Context } from "@barqel/barq";

export type WebhookProvider = "stripe" | "github" | "shopify" | "standard" | "custom";

export interface WebhookOptions {
	provider?: WebhookProvider;
	secret: string | ((ctx: Context) => string | Promise<string>);
	headerName?: string;
	toleranceSeconds?: number;
	parseJson?: boolean;
	verify?: (rawBody: string, signature: string, secret: string, ctx: Context) => boolean | Promise<boolean>;
	onInvalidSignature?: (ctx: Context, error: Error) => Response | Promise<Response>;
}

export interface WebhookPayloadState<T = unknown> {
	webhookRaw: string;
	webhookPayload: T;
	webhookProvider: WebhookProvider;
}
