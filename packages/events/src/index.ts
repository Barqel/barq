import type { App, Context } from "@barqel/barq";
import { EventBus } from "./bus";
import type { EventBusOptions } from "./types";

export * from "./bus";
export * from "./event";
export * from "./types";

export function eventsPlugin<
	TEvents extends Record<string, any> = Record<string, any>,
>(options: EventBusOptions = {}) {
	const bus = new EventBus<TEvents>(options);

	return (app: App<any>) => {
		(app as any).events = bus;

		app.use({
			before(ctx: Context) {
				(ctx.state as any).events = bus;
			},
		});
	};
}
