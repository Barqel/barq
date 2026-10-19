import { describe, expect, test } from "bun:test";
import { SchemaError } from "../../src/errors";
import { buildRowPlan, hydrateRow } from "../../src/query/hydrate";
import { defineSchema } from "../../src/schema/define";

describe("BigInt schema mode", () => {
	test("global mode marks every bigint column without mutating the input", () => {
		const input = {
			ledger: {
				id: { type: "bigint", primaryKey: true, autoIncrement: true },
				total: { type: "bigint", nullable: true },
				label: "string",
			},
		} as const;
		const schema = defineSchema(input, { bigInt: true });

		expect(schema.ledger.id).toEqual({
			type: "bigint",
			primaryKey: true,
			autoIncrement: true,
			bigInt: true,
		});
		expect(schema.ledger.total).toEqual({
			type: "bigint",
			nullable: true,
			bigInt: true,
		});
		// Non-bigint columns are copied verbatim and the caller's object is intact.
		expect(schema.ledger.label).toBe("string");
		expect(input.ledger.id).not.toHaveProperty("bigInt");
	});

	test("per-column mode leaves other bigint columns as numbers", () => {
		const schema = defineSchema({
			mixed: {
				plain: "bigint",
				huge: { type: "bigint", bigInt: true },
			},
		});

		expect(schema.mixed.plain).toBe("bigint");
		expect(schema.mixed.huge).toEqual({ type: "bigint", bigInt: true });
	});

	test("rejects bigInt on non-bigint columns", () => {
		expect(() =>
			defineSchema({
				bad: { value: { type: "integer", bigInt: true } },
			}),
		).toThrow(SchemaError);
	});

	test("rejects non-boolean options and column flags", () => {
		expect(() =>
			defineSchema({ t: { id: "bigint" } }, { bigInt: "yes" } as never),
		).toThrow(SchemaError);
		expect(() =>
			defineSchema({
				t: { id: { type: "bigint", bigInt: 1 } as never },
			}),
		).toThrow(SchemaError);
	});
});

describe("BigInt row conversion", () => {
	const plan = buildRowPlan("records", {
		defaultBig: "bigint",
		huge: { type: "bigint", bigInt: true },
		nullableHuge: { type: "bigint", bigInt: true, nullable: true },
		counter: "integer",
		active: "boolean",
	});

	test("preserves all 64 bits when bigInt is enabled", () => {
		const maximum = "9223372036854775807";
		const row = hydrateRow(plan, {
			defaultBig: maximum,
			huge: maximum,
			nullableHuge: null,
			counter: 2n,
			active: 1n,
		});

		expect(row.huge).toBe(9223372036854775807n);
		expect(row.nullableHuge).toBeNull();
		expect(row.counter).toBe(2);
		expect(row.active).toBe(true);
	});

	test("keeps the default bigint contract as a number", () => {
		const row = hydrateRow(plan, {
			defaultBig: "42",
			huge: 42n,
		});

		expect(row.defaultBig).toBe(42);
		expect(row.huge).toBe(42n);
	});

	test("leaves values it cannot convert untouched", () => {
		const row = hydrateRow(plan, {
			defaultBig: "not-a-number",
			huge: "not-an-integer",
		});

		expect(row.defaultBig).toBe("not-a-number");
		expect(row.huge).toBe("not-an-integer");
	});
});
