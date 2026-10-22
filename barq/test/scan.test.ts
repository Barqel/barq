import { describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeHandler } from "../src/internal/scan";

type ScanContext = {
	params: { id: string };
	json: (value?: object) => unknown;
};

/** A temporary file inside the platform's temp directory. */
function tempFile(extension: string): string {
	return join(
		tmpdir(),
		`barq_scan_${Math.random().toString(36).slice(2)}${extension}`,
	);
}

async function minifyHandler(
	fn: (...args: never[]) => unknown,
): Promise<(...args: never[]) => unknown> {
	const source = `export const __fn = ${fn.toString()};`;
	const tmp = tempFile(".ts");
	const file = Bun.file(tmp);
	await Bun.write(file, source);
	const result = await Bun.build({
		entrypoints: [tmp],
		minify: true,
		format: "esm",
	});
	if (!result.success) {
		throw new Error("minify failed");
	}
	const code = await result.outputs[0]!.text();
	const match = /(?:var|let|const)\s+\w+\s*=\s*([^;]+);/.exec(code);
	if (!match) {
		throw new Error(`cannot extract __fn from minified code: ${code}`);
	}
	const fnExpr = match[1]!;
	// eval preserves arrow function semantics (Function() wraps in regular function body)
	// biome-ignore lint/security/noGlobalEval: required to reconstruct arrow function from minified source
	return eval(fnExpr) as (...args: never[]) => unknown;
}

describe("analyzeHandler", () => {
	it("detects no-arg arrow functions", () => {
		expect(analyzeHandler(() => "ok").isNoArg).toBe(true);
		expect(analyzeHandler(() => ({ a: 1 })).isNoArg).toBe(true);
	});

	it("detects single-ident arrow parameter", () => {
		const r = analyzeHandler((ctx: ScanContext) => ctx.params.id);
		expect(r.isNoArg).toBe(false);
		expect(r.contextProps.has("params")).toBe(true);
	});

	it("ignores property names inside line comments", () => {
		const fn = (ctx: ScanContext) => {
			// this comment mentions ctx.cookies and ctx.json
			return ctx.params.id;
		};
		const r = analyzeHandler(fn);
		expect(r.contextProps.has("cookies")).toBe(false);
		expect(r.contextProps.has("json")).toBe(false);
		expect(r.contextProps.has("params")).toBe(true);
	});

	it("extracts a plain string literal", () => {
		const r = analyzeHandler(() => "ok");
		expect(r.literal).toEqual({ kind: "string", value: "ok" });
	});

	it("extracts a parenthesized flat JSON object without side-effects", () => {
		const r = analyzeHandler(() => ({ message: "ok", count: 42 }));
		expect(r.literal).not.toBeNull();
		expect(r.literal!.kind).toBe("json");
		expect(JSON.parse(r.literal!.value)).toEqual({ message: "ok", count: 42 });
	});

	it("does NOT extract an object with function calls", () => {
		const r = analyzeHandler(() => ({ now: Date.now() }));
		expect(r.literal).toBeNull();
	});

	it("distinguishes argless .json() from .json(value)", () => {
		const argless = analyzeHandler((ctx: ScanContext) => ctx.json());
		expect(argless.arglessJsonCall).toBe(true);

		const withArg = analyzeHandler((ctx: ScanContext) =>
			ctx.json({ custom: true }),
		);
		expect(withArg.arglessJsonCall).toBe(false);
	});

	it("serializes extracted params from maps or a single raw value", () => {
		const analysis = analyzeHandler(
			(ctx: { params: Record<string, string> }) => ({
				id: ctx.params.id,
				name: ctx.params.name,
			}),
		);
		const serialize = analysis.paramSerializer;

		expect(serialize).toBeDefined();
		expect(serialize!({ id: "42", name: "Ada" })).toBe(
			'{"id":"42","name":"Ada"}',
		);
		expect(serialize!("42")).toBe('{"id":"42","name":""}');
		expect(serialize!({ id: 'a"b\\c', name: "Ada" })).toBe(
			'{"id":"a\\"b\\\\c","name":"Ada"}',
		);
	});

	it("handles minified no-arg arrow functions", async () => {
		const minified = await minifyHandler(() => "ok");
		expect(analyzeHandler(minified).isNoArg).toBe(true);
	});

	it("handles minified string literal return", async () => {
		const minified = await minifyHandler(() => "ok");
		const r = analyzeHandler(minified);
		expect(r.literal).toEqual({ kind: "string", value: "ok" });
	});

	it("handles minified flat JSON object literal", async () => {
		const minified = await minifyHandler(() => ({ message: "ok", count: 42 }));
		const r = analyzeHandler(minified);
		expect(r.literal).not.toBeNull();
		expect(r.literal!.kind).toBe("json");
		expect(JSON.parse(r.literal!.value)).toEqual({ message: "ok", count: 42 });
	});

	it("handles minified ctx.params access", async () => {
		const minified = await minifyHandler((ctx: ScanContext) => ctx.params.id);
		const r = analyzeHandler(minified);
		expect(r.isNoArg).toBe(false);
		expect(r.contextProps.has("params")).toBe(true);
	});

	it("handles minified destructured params serializer", async () => {
		const minified = await minifyHandler(
			(ctx: { params: Record<string, string> }) => ({
				id: ctx.params.id,
				name: ctx.params.name,
			}),
		);
		const analysis = analyzeHandler(minified);
		expect(analysis.paramSerializer).toBeDefined();
		expect(analysis.paramSerializer!({ id: "42", name: "Ada" })).toBe(
			'{"id":"42","name":"Ada"}',
		);
	});

	it("handles minified argless .json() call", async () => {
		const minified = await minifyHandler((ctx: ScanContext) => ctx.json());
		expect(analyzeHandler(minified).arglessJsonCall).toBe(true);
	});

	it("handles minified comments removal before ctx access", async () => {
		const minified = await minifyHandler((ctx: ScanContext) => {
			// comment mentioning ctx.cookies and ctx.json
			return ctx.params.id;
		});
		const r = analyzeHandler(minified);
		expect(r.contextProps.has("cookies")).toBe(false);
		expect(r.contextProps.has("json")).toBe(false);
		expect(r.contextProps.has("params")).toBe(true);
	});

	it("handles minified function calls (no literal)", async () => {
		const minified = await minifyHandler(() => ({ now: Date.now() }));
		expect(analyzeHandler(minified).literal).toBeNull();
	});

	it("handles minified !0 (true) and !1 (false) in JSON objects", async () => {
		const minified = await minifyHandler(() => ({ t: !1, f: !0, a: 1 }));
		const r = analyzeHandler(minified);
		expect(r.literal).not.toBeNull();
		expect(JSON.parse(r.literal!.value)).toEqual({ t: false, f: true, a: 1 });
	});

	it("extracts JSON literal from function expression body", () => {
		// biome-ignore lint/complexity/useArrowFunction: testing function expression handling
		const fn = function () {
			return { a: 1, b: "x" };
		};
		const r = analyzeHandler(fn as unknown as (...args: never[]) => unknown);
		expect(r.literal).not.toBeNull();
		expect(r.literal!.kind).toBe("json");
		expect(JSON.parse(r.literal!.value)).toEqual({ a: 1, b: "x" });
	});

	it("extracts string literal from function expression body", () => {
		// biome-ignore lint/complexity/useArrowFunction: testing function expression handling
		const fn = function () {
			return "ok";
		};
		const r = analyzeHandler(fn as unknown as (...args: never[]) => unknown);
		expect(r.literal).toEqual({ kind: "string", value: "ok" });
	});
});

describe("scan.ts minified self-test", () => {
	it("minified scan.ts still exports and analyzes handlers correctly", async () => {
		const result = await Bun.build({
			entrypoints: ["./src/internal/scan.ts"],
			minify: true,
			format: "esm",
		});
		if (!result.success) {
			throw new Error("minify scan.ts failed");
		}
		const code = await result.outputs[0]!.text();
		const tmp = tempFile(".js");
		await Bun.write(Bun.file(tmp), code);
		const { analyzeHandler: minAnalyze } = await import(tmp);
		expect(minAnalyze(() => "ok").literal).toEqual({
			kind: "string",
			value: "ok",
		});
		expect(minAnalyze(() => ({ a: 1 })).literal).not.toBeNull();
		const r = minAnalyze((ctx: ScanContext) => ctx.params.id);
		expect(r.contextProps.has("params")).toBe(true);
	});
});
