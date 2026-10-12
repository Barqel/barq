import { createProxy } from "./handler";
import type { ProxyOptions } from "./types";

export * from "./types";
export { createProxy } from "./handler";

export function proxy(options: ProxyOptions) {
	return createProxy(options);
}
