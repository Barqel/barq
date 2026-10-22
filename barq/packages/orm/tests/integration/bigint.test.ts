import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineSchema, hasMany, Orm } from "../../src/index";
import { sqlite } from "../../src/sqlite";

const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;

const schema = defineSchema(
	{
		records: {
			id: { type: "bigint", primaryKey: true, autoIncrement: true },
			value: "bigint",
			counter: "bigint",
			views: { type: "integer", default: 0 },
			active: { type: "boolean", default: true },
		},
		scores: {
			id: { type: "integer", primaryKey: true, autoIncrement: true },
			recordId: "bigint",
			amount: "bigint",
		},
	},
	{ bigInt: true },
);

const orm = new Orm({ schema, dialect: sqlite(":memory:") });

class RecordModel extends orm.model("records") {
	static fillable = ["value", "counter", "views", "active"] as const;
	static relations = {
		scores: hasMany(() => ScoreModel, "recordId"),
	};
}

class ScoreModel extends orm.model("scores") {
	static fillable = ["recordId", "amount"] as const;
}

beforeAll(async () => {
	const ddl = orm.schemaBuilder();
	await ddl.create("records", (t) => {
		t.id();
		t.bigint("value");
		t.bigint("counter");
		t.integer("views").default(0);
		t.boolean("active").default(true);
	});
	await ddl.create("scores", (t) => {
		t.id();
		t.bigint("recordId");
		t.bigint("amount");
	});
});

afterAll(async () => {
	await orm.destroy();
});

describe("BigInt mode on SQLite", () => {
	test("round-trips the full signed 64-bit range", async () => {
		expect(orm.bigIntMode).toBe(true);

		const maximum = await orm
			.table("records")
			.insert({ value: MAX_INT64, counter: 0n });
		const minimum = await orm
			.table("records")
			.insert({ value: MIN_INT64, counter: 0n });

		expect(maximum.id).toBe(1n);
		expect(minimum.id).toBe(2n);

		const rows = await orm.table("records").orderBy("id").get();
		expect(rows).toHaveLength(2);
		expect(rows[0]?.value).toBe(MAX_INT64);
		expect(rows[1]?.value).toBe(MIN_INT64);
		expect(rows[0]?.views).toBe(0);
		expect(rows[0]?.active).toBe(true);
		expect(typeof rows[0]?.id).toBe("bigint");
	});

	test("filters, plucks and updates with bigint values", async () => {
		const found = await orm
			.table("records")
			.where("value", "=", MAX_INT64)
			.first();
		expect(found?.id).toBe(1n);

		const values = await orm.table("records").orderBy("id").pluck("value");
		expect(values.all()).toEqual([MAX_INT64, MIN_INT64]);

		const affected = await orm
			.table("records")
			.where("id", 1n)
			.update({ counter: MAX_INT64 - 1n });
		expect(affected).toBe(1);

		const updated = await orm.table("records").where("id", 1n).first();
		expect(updated?.counter).toBe(MAX_INT64 - 1n);
	});

	test("counts affected rows when incrementing a bigint counter", async () => {
		const affected = await orm
			.table("records")
			.where("id", 1n)
			.increment("counter");
		expect(affected).toBe(1);

		const row = await orm.table("records").where("id", 1n).first();
		// Number.MAX_SAFE_INTEGER + 1 is still exact in SQLite/BigInt mode.
		expect(row?.counter).toBe(MAX_INT64);
	});

	test("min/max/sum stay exact; avg is a fractional number", async () => {
		const minimum = await orm.table("records").min("value");
		const maximum = await orm.table("records").max("value");
		const sum = await orm.table("records").sum("value");
		const average = await orm.table("records").avg("value");

		expect(minimum).toBe(MIN_INT64);
		expect(maximum).toBe(MAX_INT64);
		expect(sum).toBe(-1n);
		expect(typeof average).toBe("number");
	});

	test("relation aggregates preserve bigint precision", async () => {
		await orm.table("scores").insertMany([
			{ recordId: 1n, amount: 9007199254740993n },
			{ recordId: 1n, amount: 2n },
		]);

		const record = await RecordModel.query()
			.withSum("scores", "amount")
			.withMin("scores", "amount")
			.withMax("scores", "amount")
			.withAvg("scores", "amount")
			.where("id", 1n)
			.firstOrFail();

		expect(record.scoresSumAmount).toBe(9007199254740995n);
		expect(record.scoresMinAmount).toBe(2n);
		expect(record.scoresMaxAmount).toBe(9007199254740993n);
		expect(typeof record.scoresAvgAmount).toBe("number");

		const loaded = await RecordModel.query()
			.with("scores")
			.where("id", 1n)
			.firstOrFail();
		const amounts = loaded.scores
			.map((score) => score.get("amount"))
			.sort((left, right) => (left < right ? -1 : 1))
			.all();
		expect(amounts).toEqual([2n, 9007199254740993n]);
		expect(loaded.scores.every((score) => score.get("recordId") === 1n)).toBe(
			true,
		);
	});

	test("per-column mode converts only the opted-in bigint column", async () => {
		const mixedSchema = defineSchema({
			mixed: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				plain: "bigint",
				huge: { type: "bigint", bigInt: true },
			},
		});
		const mixed = new Orm({
			schema: mixedSchema,
			dialect: sqlite(":memory:"),
		});
		expect(mixed.bigIntMode).toBe(true);
		const ddl = mixed.schemaBuilder();
		await ddl.create("mixed", (t) => {
			t.id();
			t.bigint("plain");
			t.bigint("huge");
		});
		const inserted = await mixed.table("mixed").insert({
			plain: 9007199254740991,
			huge: 9007199254740993n,
		});
		expect(inserted.id).toBe(1);
		const row = await mixed.table("mixed").firstOrFail();
		expect(row.id).toBe(1);
		expect(typeof row.plain).toBe("number");
		expect(row.plain).toBe(9007199254740991);
		expect(row.huge).toBe(9007199254740993n);
		await mixed.destroy();
	});

	test("raw SQL bypasses the row plan but keeps SQLite integers exact", async () => {
		const result = await orm.raw("select value from records where id = ?", [1]);
		expect(result.rows[0]?.value).toBe(MAX_INT64);
	});

	test("model reads, writes and primary-key lookups use bigint", async () => {
		const created = await RecordModel.create({
			value: MAX_INT64 - 1n,
			counter: 10n,
			views: 7,
			active: false,
		});

		expect(created.get("id")).toBe(3n);
		expect(created.get("value")).toBe(MAX_INT64 - 1n);
		expect(typeof created.get("counter")).toBe("bigint");

		const fetched = await RecordModel.find(3n);
		expect(fetched?.get("value")).toBe(MAX_INT64 - 1n);
		expect(fetched?.get("views")).toBe(7);
		expect(fetched?.get("active")).toBe(false);

		fetched?.set("counter", 11n);
		await fetched?.save();
		const refreshed = await RecordModel.find(3n);
		expect(refreshed?.get("counter")).toBe(11n);
	});
});
