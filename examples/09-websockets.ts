import { App, type WebSocketHandlers } from "../src";

const wsToken = Bun.env.WS_TOKEN;
if (!wsToken) {
	throw new Error("Set WS_TOKEN before starting the WebSocket example");
}

const handlers: WebSocketHandlers = {
	open(ws) {
		ws.send("Connected. Send a message to echo it back.");
	},
	message(ws, message) {
		const text = typeof message === "string" ? message : message.toString();
		ws.send(`echo: ${text}`);
	},
	close(_ws, code, reason) {
		console.log(`Socket closed (${code}): ${reason}`);
	},
	error(_ws, error) {
		console.error("WebSocket error:", error);
	},
};

const app = new App({
	websocket: {
		maxPayloadLength: 64 * 1024,
		backpressureLimit: 256 * 1024,
	},
});

app.ws("/ws", handlers, (ctx) => {
	// Perform authentication before upgrading the HTTP connection.
	return ctx.req.headers.get("authorization") === `Bearer ${wsToken}`;
});

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`Connect a WebSocket client to ws://localhost:${server.port}/ws`);
