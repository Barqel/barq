import type { App } from "@barq";
import { appApiRoutes } from "./api";

export function appRoutes(app: App): void {
	appApiRoutes(app);
}
