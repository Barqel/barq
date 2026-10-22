// Extended query-builder surface — SQLite runtime tests plus compile-only
// dialect assertions for the new where/join/CTE/read helpers.

import { beforeAll, describe, expect, test } from "bun:test";
import { defineSchema, InvalidQueryError, Orm } from "../../src/index";
import { sqlite } from "../../src/sqlite";
import { compileOnlyOrm } from "../../src/testing";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		age: { type: "integer", nullable: true },
		minAge: { type: "integer", nullable: true },
		maxAge: { type: "integer", nullable: true },
		bio: { type: "string", nullable: true },
		joinedAt: { type: "datetime", nullable: true },
		settings: { type: "json", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		createdAt: { type: "datetime", nullable: true },
	},
	archive: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
	},
});

const orm = new Orm({ schema, dialect: sqlite(":memory:") });

class UserRow extends orm.model("users") {
	static fillable = ["name", "email"] as const;
}

beforeAll(async () => {
	const builder = orm.schemaBuilder();
	await builder.create("users", (t) => {
		t.id();
		t.string("name");
		t.string("email");
		t.integer("age").nullable();
		t.integer("minAge").nullable();
		t.integer("maxAge").nullable();
		t.string("bio").nullable();
		t.datetime("joinedAt").nullable();
		t.json("settings").nullable();
	});
	await builder.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title");
		t.integer("views").default(0);
		t.datetime("createdAt").nullable();
	});
	await builder.create("archive", (t) => {
		t.id();
		t.integer("userId");
		t.string("title");
	});
});

async function seed(): Promise<void> {
	await orm.table("posts").delete();
	await orm.table("users").delete();
	const alice = await orm.table("users").insert({
		name: "Alice",
		email: "alice@example.com",
		age: 30,
		minAge: 18,
		maxAge: 40,
		bio: "hello world",
		joinedAt: new Date("2000-01-01T00:00:00.000Z"),
		settings: JSON.stringify(["a", "b"]),
	});
	const bob = await orm.table("users").insert({
		name: "Bob",
		email: "bob@example.com",
		age: 50,
		minAge: 18,
		maxAge: 40,
		bio: "goodbye",
		joinedAt: new Date("2999-01-01T00:00:00.000Z"),
		settings: JSON.stringify(["c"]),
	});
	await orm.table("users").insert({
		name: "Carol",
		email: "carol@test.org",
		age: null,
		minAge: null,
		maxAge: null,
		bio: null,
		joinedAt: null,
		settings: null,
	});
	await orm.table("posts").insert([
		{ userId: alice.id!, title: "First", views: 10 },
		{ userId: alice.id!, title: "Second", views: 0 },
		{ userId: bob.id!, title: "Third", views: 5 },
	]);
}

describe("where variants", () => {
	beforeAll(seed);

	test("orWhereIn / orWhereNotIn / orWhereNull / orWhereNotNull", async () => {
		const inRows = await orm
			.table("users")
			.where("name", "=", "Alice")
			.orWhereIn("age", [50])
			.get();
		expect(
			inRows
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Bob"]);

		const notIn = await orm
			.table("users")
			.whereNull("bio")
			.orWhereNotIn("age", [30, 50])
			.get();
		// Carol (bio null) + nobody else falls outside [30,50].
		expect(notIn.map((r) => r.name).all()).toEqual(["Carol"]);

		const nulls = await orm
			.table("users")
			.where("name", "=", "Alice")
			.orWhereNull("age")
			.get();
		expect(
			nulls
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Carol"]);

		const notNull = await orm
			.table("users")
			.where("name", "=", "Carol")
			.orWhereNotNull("age")
			.get();
		expect(
			notNull
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Bob", "Carol"]);
	});

	test("orWhereBetween / orWhereRaw / orWhereColumn", async () => {
		const between = await orm
			.table("users")
			.where("name", "=", "Carol")
			.orWhereBetween("age", [45, 60])
			.get();
		expect(
			between
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Bob", "Carol"]);

		const raw = await orm
			.table("users")
			.whereRaw("age = ?", [30])
			.orWhereRaw("age = ?", [50])
			.get();
		expect(
			raw
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Bob"]);

		const columns = await orm
			.table("users")
			.where("name", "=", "Carol")
			.orWhereColumn("age", ">", "maxAge")
			.get();
		expect(
			columns
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Bob", "Carol"]);
	});

	test("whereBetweenColumns / whereNotBetweenColumns", async () => {
		const inside = await orm
			.table("users")
			.whereBetweenColumns("age", ["minAge", "maxAge"])
			.get();
		expect(inside.map((r) => r.name).all()).toEqual(["Alice"]);

		const outside = await orm
			.table("users")
			.whereNotNull("age")
			.whereNotBetweenColumns("age", ["minAge", "maxAge"])
			.get();
		expect(outside.map((r) => r.name).all()).toEqual(["Bob"]);
	});
});

describe("like family", () => {
	beforeAll(seed);

	test("whereLike / whereNotLike / orWhereLike", async () => {
		const like = await orm.table("users").whereLike("name", "Al%").get();
		expect(like.map((r) => r.name).all()).toEqual(["Alice"]);

		const notLike = await orm.table("users").whereNotLike("name", "A%").get();
		expect(
			notLike
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Bob", "Carol"]);

		const orLike = await orm
			.table("users")
			.where("name", "=", "Carol")
			.orWhereLike("name", "B%")
			.get();
		expect(
			orLike
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Bob", "Carol"]);
	});

	test("whereStartsWith / whereEndsWith / whereContains", async () => {
		expect(
			(await orm.table("users").whereStartsWith("name", "Bo").get())
				.map((r) => r.name)
				.all(),
		).toEqual(["Bob"]);
		expect(
			(await orm.table("users").whereEndsWith("name", "rol").get())
				.map((r) => r.name)
				.all(),
		).toEqual(["Carol"]);
		expect(
			(await orm.table("users").whereContains("bio", "world").get())
				.map((r) => r.name)
				.all(),
		).toEqual(["Alice"]);
	});
});

describe("json variants", () => {
	beforeAll(seed);

	test("whereJsonDoesntContain / orWhereJsonContains", async () => {
		const hasA = await orm
			.table("users")
			.whereJsonContains("settings", "a")
			.get();
		expect(hasA.map((r) => r.name).all()).toEqual(["Alice"]);

		const notA = await orm
			.table("users")
			.whereJsonDoesntContain("settings", "a")
			.get();
		// Bob has ["c"]; Carol is null (not(contains) is true for null too).
		expect(
			notA
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Bob", "Carol"]);

		const orContains = await orm
			.table("users")
			.where("name", "=", "Bob")
			.orWhereJsonContains("settings", "a")
			.get();
		expect(
			orContains
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Bob"]);
	});
});

describe("relative date shortcuts", () => {
	beforeAll(seed);

	test("wherePast / whereFuture", async () => {
		expect(
			(await orm.table("users").wherePast("joinedAt").get())
				.map((r) => r.name)
				.all(),
		).toEqual(["Alice"]);
		expect(
			(await orm.table("users").whereFuture("joinedAt").get())
				.map((r) => r.name)
				.all(),
		).toEqual(["Bob"]);
	});

	test("whereBeforeToday / whereAfterToday / orWhereDate / orWhereYear", async () => {
		expect(
			(await orm.table("users").whereBeforeToday("joinedAt").get())
				.map((r) => r.name)
				.all(),
		).toEqual(["Alice"]);
		expect(
			(await orm.table("users").whereAfterToday("joinedAt").get())
				.map((r) => r.name)
				.all(),
		).toEqual(["Bob"]);

		const year = await orm
			.table("users")
			.where("name", "=", "Bob")
			.orWhereYear("joinedAt", "=", 2000)
			.get();
		expect(
			year
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Bob"]);
	});
});

describe("subquery members", () => {
	beforeAll(seed);

	test("whereInSub / whereNotInSub from another table", async () => {
		const withPosts = await orm
			.table("users")
			.whereInSub("id", "posts", (posts) => {
				posts.select("userId").where("views", ">", 4);
			})
			.get();
		expect(
			withPosts
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Bob"]);

		const withoutPosts = await orm
			.table("users")
			.whereNotInSub("id", "posts", (posts) => {
				posts.select("userId").where("views", ">", 4);
			})
			.get();
		expect(withoutPosts.map((r) => r.name).all()).toEqual(["Carol"]);
	});
});

describe("full text", () => {
	test("throws on SQLite", () => {
		expect(() => orm.table("users").whereFullText("bio", "hello")).toThrow(
			InvalidQueryError,
		);
	});

	test("compiles MATCH on MySQL", () => {
		const mysql = compileOnlyOrm(schema, "mysql");
		const sql = mysql
			.table("users")
			.whereFullText(["bio"], "hello", { mode: "boolean" })
			.toSQL().sql;
		expect(sql.toLowerCase()).toContain("match(");
		expect(sql.toLowerCase()).toContain("against");
		expect(sql.toLowerCase()).toContain("boolean mode");
	});

	test("compiles to_tsvector on PostgreSQL", () => {
		const pg = compileOnlyOrm(schema, "postgres");
		const sql = pg.table("users").whereFullText("bio", "hello").toSQL().sql;
		expect(sql).toContain("to_tsvector");
		expect(sql).toContain("plainto_tsquery");
	});
});

describe("having", () => {
	beforeAll(seed);

	test("orHaving / orHavingRaw / havingBetween", async () => {
		const alice = await orm.table("users").where("name", "=", "Alice").first();
		const bob = await orm.table("users").where("name", "=", "Bob").first();

		const grouped = await orm
			.table("posts")
			.select("userId")
			.groupBy("userId")
			.havingRaw("count(*) >= ?", [2])
			.orHavingRaw("sum(views) > ?", [100])
			.get();
		expect(
			grouped
				.map((r) => Number(r.userId))
				.sort()
				.all(),
		).toEqual([alice!.id]);

		const between = await orm
			.table("posts")
			.select("userId")
			.groupBy("userId")
			.havingBetween("userId", [bob!.id as number, bob!.id as number])
			.get();
		expect(between.map((r) => Number(r.userId)).all()).toEqual([bob!.id]);
	});
});

describe("joins and CTEs", () => {
	beforeAll(seed);

	test("joinSub / leftJoinSub compile", () => {
		const sub = orm.table("posts").select("userId").where("views", ">", 0);
		const sql = orm
			.table("posts")
			.joinSub(sub, "hot", "posts.userId", "=", "hot.userId")
			.toSQL().sql;
		expect(sql).toContain("inner join (select");
		expect(sql).toContain('as "hot"');
	});

	test("crossJoin compiles", () => {
		const sql = orm.table("users").crossJoin("posts").toSQL().sql;
		expect(sql).toContain("cross join");
	});

	test("fromSub replaces the FROM clause", () => {
		const sub = orm.table("users").select("id", "name");
		const sql = orm.table("users").fromSub(sub, "u").toSQL().sql;
		expect(sql).toContain("from (select");
		expect(sql).toContain('as "u"');
	});

	test("withCte + fromCte", async () => {
		const adults = orm
			.table("users")
			.select("id", "name")
			.where("age", ">", 18);
		const rows = await orm
			.table("users")
			.withCte("adults", adults)
			.fromCte("adults")
			.orderBy("name")
			.get();
		expect(rows.map((r) => r.name).all()).toEqual(["Alice", "Bob"]);
	});
});

describe("SQL inspection", () => {
	beforeAll(seed);

	test("toRawSql interpolates bindings", () => {
		const raw = orm
			.table("users")
			.where("name", "=", "Alice")
			.where("age", ">", 21)
			.toRawSql();
		expect(raw).toContain("'Alice'");
		expect(raw).toContain("21");
		expect(raw).not.toContain("?");
	});

	test("tap applies inline tweaks", async () => {
		const names = await orm
			.table("users")
			.tap((q) => q.where("age", ">", 40))
			.pluck("name");
		expect(names.all()).toEqual(["Bob"]);
	});
});

describe("batched reads", () => {
	beforeAll(seed);

	test("chunkMap maps pages into a flat collection", async () => {
		const upper = await orm
			.table("users")
			.chunkMap((rows) => rows.map((r) => r.name.toUpperCase()), 2);
		expect(upper.all().sort()).toEqual(["ALICE", "BOB", "CAROL"]);
	});

	test("chunkByIdDesc iterates in descending key order", async () => {
		const seen: number[] = [];
		await orm.table("users").chunkByIdDesc(2, (rows) => {
			for (const row of rows) seen.push(row.id as number);
		});
		expect(seen.length).toBe(3);
		expect(seen[0]).toBeGreaterThan(seen[1]!);
		expect(seen[1]).toBeGreaterThan(seen[2]!);
	});

	test("lazyByIdDesc yields descending rows", async () => {
		const ids: number[] = [];
		for await (const row of orm.table("users").lazyByIdDesc(2)) {
			ids.push(row.id as number);
		}
		expect(ids.length).toBe(3);
		expect(ids[0]).toBeGreaterThan(ids[1]!);
		expect(ids[1]).toBeGreaterThan(ids[2]!);
	});

	test("each / eachById run per row and can stop", async () => {
		const seen: string[] = [];
		await orm.table("users").each((row) => {
			seen.push(row.name as string);
		});
		expect(seen.length).toBe(3);

		const stopped: string[] = [];
		await orm.table("users").eachById((row) => {
			stopped.push(row.name as string);
			return stopped.length < 2;
		});
		expect(stopped.length).toBe(2);
	});
});

describe("page / row values / insert-using", () => {
	beforeAll(seed);

	test("forPage paginates by limit and offset", async () => {
		const page = await orm.table("users").orderBy("name").forPage(2, 2).get();
		expect(page.map((r) => r.name).all()).toEqual(["Carol"]);
	});

	test("whereRowValues compares tuples", async () => {
		const rows = await orm
			.table("users")
			.whereRowValues(["age", "maxAge"], ">", [18, 30])
			.get();
		expect(
			rows
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Bob"]);
	});

	test("insertUsing inserts from a select", async () => {
		await orm.table("archive").delete();
		const inserted = await orm
			.table("archive")
			.insertUsing(["userId", "title"], "posts", (posts) => {
				posts.select("userId", "title");
			});
		expect(inserted).toBe(3);
		expect(await orm.table("archive").count()).toBe(3);
	});

	test("findMany / whereKey / whereKeyNot", async () => {
		const alice = await orm.table("users").where("name", "=", "Alice").first();
		const bob = await orm.table("users").where("name", "=", "Bob").first();
		const many = await orm.table("users").findMany([alice!.id, bob!.id]);
		expect(
			many
				.map((r) => r.name)
				.sort()
				.all(),
		).toEqual(["Alice", "Bob"]);

		const keyed = await orm.table("users").whereKey(alice!.id).first();
		expect(keyed!.name).toBe("Alice");

		const others = await orm.table("users").whereKeyNot(alice!.id).get();
		expect(others.some((r) => r.name === "Alice")).toBe(false);
	});
});

describe("model create helpers", () => {
	beforeAll(seed);

	test("forceFill bypasses fillable and persists", async () => {
		const user = (await UserRow.query().where("name", "=", "Alice").first())!;
		user.forceFill({ age: 99 });
		await user.save();
		const stored = await orm.table("users").where("name", "=", "Alice").first();
		expect(stored!.age).toBe(99);
	});

	test("createQuietly suppresses model events", async () => {
		let creating = 0;
		const off = UserRow.on("creating", () => {
			creating += 1;
		});
		await UserRow.createQuietly({
			name: "Quiet",
			email: "quiet@example.com",
		});
		off();
		expect(creating).toBe(0);
		const stored = await orm.table("users").where("name", "=", "Quiet").first();
		expect(stored).not.toBeNull();
	});

	test("forceCreate bypasses fillable", async () => {
		await UserRow.forceCreate({
			name: "Forced",
			email: "forced@example.com",
			age: 77,
		});
		const stored = await orm
			.table("users")
			.where("name", "=", "Forced")
			.first();
		expect(stored!.age).toBe(77);
	});
});
