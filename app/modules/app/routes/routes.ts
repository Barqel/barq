import type { App } from "@barq";
import { appApiRoutes } from "./api";

export function appRoutes(app: App): void {
	// `routes/routes.ts` is the only entry auto-loaded at boot.
	// Compose the module's route groups here.
	appApiRoutes(app);
}
