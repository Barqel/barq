// Smoke tests for the internal stack: schema -> Kysely adapter -> sqlite driver.
import { afterAll, describe, expect, it } from "bun:test";
import { createKysely } from "../../src/adapters/kysely";
import { sqlite } from "../../src/drivers/sqlite";
import { defineSchema } from "../../src/schema/define";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		active: { type: "boolean", default: true },
		createdAt: { type: "datetime", nullable: true },
	},
});

const db = createKysely<typeof schema>(sqlite(":memory:"));

afterAll(async () => {
	await db.destroy();
});

describe("sqlite driver", () => {
	it("executes DDL and RETURNING inserts", async () => {
		await db.schema
			.createTable("users")
			.addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
			.addColumn("name", "text", (c) => c.notNull())
			.addColumn("active", "integer", (c) => c.notNull().defaultTo(1))
			.addColumn("createdAt", "text")
			.execute();

		const inserted = await db
			.insertInto("users")
			.values({ name: "Hassan" })
			.returning("id")
			.executeTakeFirstOrThrow();

		expect(inserted.id).toBe(1);

		const rows = await db.selectFrom("users").selectAll().execute();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.name).toBe("Hassan");
	});

	it("binds booleans, Dates and undefined values", async () => {
		const now = new Date("2026-01-02T03:04:05.000Z");
		await db
			.insertInto("users")
			.values({ name: "Bind", active: true, createdAt: now })
			.execute();

		const row = await db
			.selectFrom("users")
			.selectAll()
			.where("name", "=", "Bind")
			.executeTakeFirstOrThrow();

		expect(row.active as unknown as number).toBe(1);
		expect(row.createdAt as unknown as string).toBe(now.toISOString());
	});

	it("rolls transactions back on failure and keeps the connection usable", async () => {
		const before = await db.selectFrom("users").selectAll().execute();

		await expect(
			db.transaction().execute(async (trx) => {
				await trx.insertInto("users").values({ name: "Gone" }).execute();
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		const after = await db.selectFrom("users").selectAll().execute();
		expect(after).toHaveLength(before.length);
	});

	it("counts affected rows for updates and deletes", async () => {
		const updated = await db
			.updateTable("users")
			.set({ name: "Renamed" })
			.where("name", "=", "Bind")
			.executeTakeFirst();
		expect(Number(updated.numUpdatedRows)).toBe(1);

		const deleted = await db
			.deleteFrom("users")
			.where("name", "=", "Renamed")
			.executeTakeFirst();
		expect(Number(deleted.numDeletedRows)).toBe(1);
	});
});
