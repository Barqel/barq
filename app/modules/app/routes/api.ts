// Route group owned by the `app` module.
//
// `routes/routes.ts` is the only entry auto-loaded at boot, so import this
// function there and mount it.
import type { App } from "@barq";
import { appV1Routes } from "./v1";

export function appApiRoutes(app: App): void {
	app.group("/api", (group) => {
		// Nested groups keep the version prefix: this mounts `/api/v1`.
		appV1Routes(group);

		// group.get("/", () => ({ ok: true }));
	});
}
