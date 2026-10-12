import type { App, Context } from "@barqel/barq";
import { BarqClient } from "./client";
import type { ClientOptions } from "./types";

export * from "./types";
export * from "./circuit-breaker";
export * from "./retry";
export * from "./client";

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
