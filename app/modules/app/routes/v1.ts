import type { RouteGroup } from "@barq";

export function appV1Routes<Prefix extends string>(
	group: RouteGroup<Prefix>,
): void {
	group.group("/v1", (v1) => {
		v1.get("/", () => ({ ok: true }));
	});
}
