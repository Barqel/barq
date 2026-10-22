// Route group owned by the `app` module.
//
// Mounted from `routes/api.ts` inside the `/api` group, so this version is
// served under `/api/v1`. It takes a route group (not the root `App`) to nest
// under whatever prefix the caller already set.
import type { RouteGroup } from "@barq";

export function appV1Routes<Prefix extends string>(
	group: RouteGroup<Prefix>,
): void {
	group.group("/v1", (v1) => {
		// v1.get(