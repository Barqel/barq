// Single typed access point to the event bus created by `eventsPlugin()`.
// `setEventBus` is called once at boot (`createApp()`); every other layer
// uses `eventBus()` (anywhere, incl. cron jobs) or `ctxEvents(ctx)`
// (request scope, reads the bus injected into `ctx.state.events`).
import type { Context } from "@barqel/barq";
import type { EventBus } from "@barqel/barq-events";

let bus: EventBus | null = null;

export function setEventBus(next: EventBus): void {
	bus = next;
}

export function eventBus(): EventBus {
	if (!bus) {
		throw new Error(
			"Event bus is not initialized. Register eventsPlugin() at boot.",
		);
	}

	return bus;
}

export function ctxEvents(ctx: Context): EventBus {
	return ctx.state.events as EventBus;
}
