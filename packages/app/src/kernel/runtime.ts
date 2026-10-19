// Latest resolved runtime info (name, env, port, docs paths), recorded by
// `createApp()` / `runCli()` so built-in commands such as `app:info` can
// show the real values — including any overrides from `barq.config.ts`.
import { env } from "./env";

export interface RuntimeInfo {
	name: string;
	env: string;
	port: number;
	docsPath: string;
	specPath: string;
}

let current: RuntimeInfo | null = null;

export function setRuntimeInfo(info: RuntimeInfo): void {
	current = info;
}

export function runtimeInfo(): RuntimeInfo {
	return (
		current ?? {
			name: "Barq App",
			env: env.APP_ENV,
			port: env.APP_PORT,
			docsPath: "/docs",
			specPath: "/openapi.json",
		}
	);
}
