import type { App } from "@barq";
import { appV1Routes } from "./v1";

export function appApiRoutes(app: App): void {
	app.group("/api", (group) => {
		appV1Routes(group);
	});
}
