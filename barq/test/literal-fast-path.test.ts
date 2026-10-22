import { describe, expect, it } from "bun:test";
import { App } from "../src/app";
import { analyzeHandler } from "../src/internal/scan";

// The runtime transpiles `true`/`false` to `!0`/`!1` inside Function.prototype.toString(),
// so the literal fast-path must decode those forms correctly.
describe("static literal fast-path", () => {
	it("preserves top-level booleans in returned object literals", async () => {
		const app = new App();
		app.get("/t", () => ({ t: true, u: false }));
		app.get("/f", () => ({ ok: true }));
		app.get("/s", () => ({ s: "x", n: 1 }));
		const server = app.listen(0);

		try {
			const t = await fetch(`http://localhost:${server.port}/t`);
			expect(await t.json()).toEqual({ t: true, u: false });

			const f = await fetch(`http://localhost:${server.port}/f`);
			expect(await f.json()).toEqual({ ok: true });

			const s = await fetch(`http://localhost:${server.port}/s`);
			expect(await s.json()).toEqual({ s: "x", n: 1 });
		} finally {
			await app.stop();
		}
	});

	it("preserves booleans nested inside returned object literals", async () => {
		const app = new App();
		app.get("/n", () => ({ deep: { ok: true, off: false } }));
		const server = app.listen(0);

		try {
			const res = await fetch(`http://localhost:${server.port}/n`);
			expect(await res.json()).toEqual({ deep: { ok: true, off: false } });
		} finally {
			await app.stop();
		}
	});

	it("extracts literals with the correct boolean values", () => {
		const analysis = analyzeHandler((() => ({
			ok: true,
			off: false,
		})) as never);
		expect(analysis.literal).toEqual({
			kind: "json",
			value: '{"ok":true,"off":false}',
		});
	});
});
