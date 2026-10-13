import { App, json, redirect } from "../src";

const app = new App({
	allowedRedirectHosts: ["docs.example.com"],
});

app.get("/local-redirect", () => redirect("/docs", 303));
app.get("/external-redirect", (ctx) =>
	ctx.redirect("https://docs.example.com/barq"),
);

app.get("/slow-report", async (ctx) => {
	// Increase the timeout only for this request; the server-wide timeout stays on.
	ctx.timeout(90);
	await Bun.sleep(250);
	return json({ report: "ready" });
});

app.get("/events", (ctx) => {
	ctx.disableTimeout();
	const encoder = new TextEncoder();
	let interval: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode("event: ready\ndata: connected\n\n"));
			interval = setInterval(() => {
				controller.enqueue(encoder.encode(": keep-alive\n\n"));
			}, 15_000);
		},
		cancel() {
			if (interval !== undefined) clearInterval(interval);
		},
	});
	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache",
		},
	});
});

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(
	`Redirect and timeout example listening at http://localhost:${server.port}`,
);
