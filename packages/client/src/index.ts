import type { App, Context } from "@barqel/barq";
import { BarqClient } from "./client";
import type { ClientOptions } from "./types";

export * from "./circuit-breaker";
export * from "./client";
export * from "./retry";
export * from "./types";

export function createClient(options: ClientOptions = {}): BarqClient {
	return new BarqClient(options);
}

export function clientPlugin(options: ClientOptions = {}) {
	const rootClient = new BarqClient(options);

	return (app: App<any>) => {
		(app as any).client = rootClient;

		app.use({
			before(ctx: Context) {
				(ctx.state as any).client = rootClient.withContext(ctx);
			},
		});
	};
}
