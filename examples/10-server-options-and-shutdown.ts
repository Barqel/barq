import { App, json } from "../src";

const app = new App({
	hostname: "127.0.0.1",
	maxRequestBodySize: 1_048_576,
	idleTimeout: 30,
});

app.get("/health", () => json({ ok: true }));

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`Listening on ${server.hostname}:${server.port}`);

let stopping = false;
const shutdown = async (signal: string) => {
	if (stopping) return;
	stopping = true;
	console.log(`Received ${signal}; draining active connections...`);
	const result = await app.stop(5_000);
	console.log(
		`Shutdown complete (forced=${result.forced}, pending=${result.pending})`,
	);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
