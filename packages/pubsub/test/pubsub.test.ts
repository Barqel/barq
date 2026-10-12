import { describe, expect, it } from "bun:test";
import { App } from "@barqel/barq";
import { PubSubRegistry, pubsubPlugin } from "../src/index";

describe("@barqel/barq-pubsub", () => {
	it("registers pubsub on the application instance", () => {
		const app = new App();
		app.plugin(pubsubPlugin());
		expect((app as any).pubsub).toBeInstanceOf(PubSubRegistry);
	});

	it("manages rooms, subscriptions, and broadcasting", async () => {
		const app = new App();
		app.plugin(pubsubPlugin());
		const pubsub = (app as any).pubsub as PubSubRegistry;

		app.ws("/chat", {
			message(ws, msg) {
				const data = JSON.parse(msg.toString());
				if (data.action === "join") {
					pubsub.subscribe(ws, data.room);
					ws.send(JSON.stringify({ joined: data.room, size: pubsub.getRoomSize(data.room) }));
				} else if (data.action === "send") {
					pubsub.publish(data.room, JSON.stringify({ message: data.text }));
				}
			},
			close(ws) {
				pubsub.unsubscribeAll(ws);
			},
		});

		const server = app.listen(0);

		try {
			const client1 = new WebSocket(`ws://localhost:${server.port}/chat`);
			const client2 = new WebSocket(`ws://localhost:${server.port}/chat`);

			await new Promise((resolve) => {
				let connected = 0;
				client1.onopen = () => { if (++connected === 2) resolve(null); };
				client2.onopen = () => { if (++connected === 2) resolve(null); };
			});

			const c1Msgs: any[] = [];
			const c2Msgs: any[] = [];

			client1.onmessage = (e) => c1Msgs.push(JSON.parse(e.data));
			client2.onmessage = (e) => c2Msgs.push(JSON.parse(e.data));

			client1.send(JSON.stringify({ action: "join", room: "general" }));
			client2.send(JSON.stringify({ action: "join", room: "general" }));

			await Bun.sleep(50);
			expect(pubsub.getRoomSize("general")).toBe(2);

			client1.send(JSON.stringify({ action: "send", room: "general", text: "Hello World" }));

			await Bun.sleep(50);

			const receivedC2 = c2Msgs.find(m => m.message === "Hello World");
			expect(receivedC2).toBeDefined();

			client1.close();
			await Bun.sleep(50);

			expect(pubsub.getRoomSize("general")).toBe(1);

			client2.close();
			await Bun.sleep(50);
			
			expect(pubsub.getRoomSize("general")).toBe(0);
		} finally {
			await app.stop();
		}
	});
});
