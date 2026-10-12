import { describe, expect, it } from "bun:test";
import { EventBus } from "../src/index";

describe("@barqel/barq-events", () => {
	it("emits events and handles listeners asynchronously", async () => {
		const bus = new EventBus<{ "user.created": { id: string; email: string } }>();
		let captured: any = null;

		bus.on("user.created", async (payload) => {
			await Bun.sleep(10);
			captured = payload;
		});

		await bus.emit("user.created", { id: "u1", email: "ada@example.com" });
		expect(captured).toEqual({ id: "u1", email: "ada@example.com" });
	});

	it("supports wildcard listeners", async () => {
		const bus = new EventBus();
		const events: string[] = [];

		bus.on("order.*", (_, event) => {
			events.push(event);
		});

		await bus.emit("order.placed", { orderId: 101 });
		await bus.emit("order.shipped", { orderId: 101 });
		await bus.emit("user.login", { userId: 5 });

		expect(events).toEqual(["order.placed", "order.shipped"]);
	});

	it("executes once listeners exactly once", async () => {
		const bus = new EventBus();
		let callCount = 0;

		bus.once("notify", () => {
			callCount++;
		});

		await bus.emit("notify");
		await bus.emit("notify");

		expect(callCount).toBe(1);
	});

	it("executes listeners serially with emitSerial", async () => {
		const bus = new EventBus();
		const trace: number[] = [];

		bus.on("step", async () => {
			await Bun.sleep(20);
			trace.push(1);
		});
		bus.on("step", async () => {
			trace.push(2);
		});

		await bus.emitSerial("step");
		expect(trace).toEqual([1, 2]);
	});
});
