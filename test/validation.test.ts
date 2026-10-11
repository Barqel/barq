import { describe, expect, it } from "bun:test";
import { Context, type ContextApplication } from "../src/context";
import { validateJson } from "../src/validation";

const contextApplication: ContextApplication = {
	development: false,
	redirectHosts: new Set(),
	trustProxy: false,
};

describe("validateJson", () => {
	it("parses the JSON body and passes typed data to the handler", async () => {
		const handler = validateJson(
			{
				parse(data: unknown) {
					if (
						typeof data !== "object" ||
						data === null ||
						!("name" in data) ||
						typeof data.name !== "string"
					) {
						throw new TypeError("name must be a string");
					}
					return { name: data.name };
				},
			},
			(_ctx, body) => new Response(body.name),
		);
		const ctx = new Context(
			new Request("http://localhost/", {
				method: "POST",
				body: JSON.stringify({ name: "Barq" }),
				headers: { "content-type": "application/json" },
			}),
			null,
			{},
			contextApplication,
		);

		expect(await (await handler(ctx)).text()).toBe("Barq");
	});

	it("propagates validation failures to the framework error pipeline", async () => {
		const handler = validateJson(
			{
				parse: (_data: unknown): never => {
					throw new TypeError("invalid body");
				},
			},
			() => new Response("unreachable"),
		);
		const ctx = new Context(
			new Request("http://localhost/", {
				method: "POST",
				body: "{}",
				headers: { "content-type": "application/json" },
			}),
			null,
			{},
			contextApplication,
		);

		await expect(handler(ctx)).rejects.toThrow("invalid body");
	});
});
