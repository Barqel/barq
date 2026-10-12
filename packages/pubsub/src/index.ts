import type { App } from "@barqel/barq";
import { PubSubRegistry } from "./registry";
import type { PubSubInterface } from "./types";

export * from "./types";
export * from "./registry";

export function pubsubPlugin() {
	const registry = new PubSubRegistry();
	return (app: App<any>) => {
		(app as any).pubsub = registry;
	};
}
