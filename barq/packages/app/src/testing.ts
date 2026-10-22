// Test helper: boots the real application (same plugins, routes, error
// handling and localization as production) on an ephemeral port with
// scheduled jobs off.
//
//   import { createTestApp } from "@barq";
//   import config from "../barq.config";
//
//   const server = createTestApp(config);
//   await fetch(`${server.baseUrl}/health`);
//   await server.close();
import type { App } from "@barqel/barq";
import { type BarqConfig, createApp, shutdown } from "./kernel/app";

export interface TestServer {
	app: App;
	baseUrl: string;
	close: () => Promise<void>;
}

export interface TestAppOptions {
	/** Start job timers too (default: false — tests stay deterministic). */
	jobs?: boolean;
}

export function createTestApp(
	config: BarqConfig = {},
	options: TestAppOptions = {},
): TestServer {
	const app = createApp(config, { jobs: options.jobs ?? false });
	const server = app.listen(0);

	return {
		app,
		baseUrl: `http://127.0.0.1:${server.port}`,
		close: () => shutdown(app),
	};
}
