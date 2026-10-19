// Priority-2 Eloquent parity features — SQLite runtime tests.
//
// Covers: cast/date parity (int, float, object, decimal:n, date:format,
// immutable_*), Blueprint/migrator extras (char, sized ints, jsonb,
// foreignIdFor/constrained, dropColumn arrays, dropIndex/dropUnique,
// reset/refresh/fresh/pretend), pruning, factories + seeders, multi-connection
// routing, query-builder macros, JSON extras (paths, containsKey, overlaps),
// whereMorphedTo / whereAttachedTo, and custom pivot models (`using`).

import { beforeAll, describe, expect, test } from "bun:test";
import {
	belongsTo,
	belongsToMany,
	defineSchema,
	Factory,
	hasMany,
	InvalidModelUsageError,
	InvalidQueryError,
	type MigrationContext,
	Migrator,
	morphTo,
	Orm,
	Pivot,
	runSeeders,
	SchemaError,
} from "../../src/index";
import { sqlite } from "../../src/sqlite";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		age: { type: "integer", nullable: true },
		score: { type: "float", nullable: true },
		settings: { type: "json", nullable: true },
		joinedAt: { type: "datetime", nullable: true },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
		deletedAt: { type: "datetime", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		createdAt: { type: "datetime", nullable: true },
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		body: "string",
		commentableId: { type: "integer", nullable: true },
		commentableType: { type: "string", nullable: true },
	},
	roles: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	role_user: {
		userId: "integer",
		roleId: "integer",
		note: { type: "string", nullable: true },
		grantedAt: { type: "datetime", nullable: true },
	},
	expired_sessions: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		token: "string",
		expiresAt: { type: "datetime" },
	},
	audit_events: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		message: "string",
	},
});

const orm = new Orm({
	schema,
	dialect: sqlite(":memory:"),
	connections: { audit: sqlite(":memory:") },
});

class Membership extends orm.pivot("role_user") {
	static override casts = {
		note: "string",
		grantedAt: "date:Y-m-d",
	} as const;
}

class User extends orm.model("users") {
	static relations = {
		posts: hasMany(() => Post, "userId"),
		roles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
			withPivot: ["note", "grantedAt"],
			using: Membership,
		}),
	};
	static fillable = ["name", "email", "age", "score"] as const;
}

class Post extends orm.model("posts") {
	static relations = {
		author: belongsTo(() => User, "userId"),
	};
}

class Comment extends orm.model("comments") {
	static relations = {
		commentable: morphTo("commentable", () => ({ posts: Post, users: User })),
	};
}

class Role extends orm.model("roles") {
	static relations = {
		users: belongsToMany(() => User, {
			through: "role_user",
			foreignPivotKey: "roleId",
			relatedPivotKey: "userId",
		}),
	};
}

class ExpiredSession extends orm.model("expired_sessions") {
	static prunable = (query: unknown) => {
		(query as { where(c: string, op: string, v: unknown): unknown }).where(
			"expiresAt",
			"<",
			new Date("2026-01-01T00:00:00Z"),
		);
	};
}

class AuditEvent extends orm.model("audit_events") {
	static connection = "audit";
}

beforeAll(async () => {
	const builder = orm.schemaBuilder();
	await builder.create("users", (t) => {
		t.id();
		t.string("name");
		t.string("email");
		t.integer("age").nullable();
		t.float("score").nullable();
		t.json("settings").nullable();
		t.datetime("joinedAt").nullable();
		t.datetime("createdAt").nullable();
		t.datetime("updatedAt").nullable();
		t.datetime("deletedAt").nullable();
	});
	await builder.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title");
		t.integer("views").default(0);
		t.datetime("createdAt").nullable();
	});
	await builder.create("comments", (t) => {
		t.id();
		t.string("body");
		t.integer("commentableId").nullable();
		t.string("commentableType").nullable();
	});
	await builder.create("roles", (t) => {
		t.id();
		t.string("name");
	});
	await builder.create("role_user", (t) => {
		t.integer("userId");
		t.integer("roleId");
		t.string("note").nullable();
		t.datetime("grantedAt").nullable();
	});
	await builder.create("expired_sessions", (t) => {
		t.id();
		t.string("token");
		t.datetime("expiresAt");
	});
	await builder.create("audit_events", (t) => {
		t.id();
		t.string("message");
	});
	await orm
		.connection("audit")
		.schemaBuilder()
		.create("audit_events", (t) => {
			t.id();
			t.string("message");
		});
});

describe("casts — int/float/object/decimal:/date:format/immutable", () => {
	class CastedUser extends orm.model("users") {
		static casts = {
			age: "int",
			score: "float",
			settings: "object",
			joinedAt: "date:Y-m-d",
			createdAt: "immutable_datetime",
		} as const;
	}

	test("int and float casts apply on write and read", async () => {
		const user = await CastedUser.create({
			name: "Ada",
			email: "ada@example.com",
			age: 41.9,
			// Built-in cast names coerce at runtime; the type layer keeps the
			// schema type (documented limitation).
			score: "9.5" as unknown as number,
		});
		expect(user.get("age")).toBe(41);
		expect(user.get("score")).toBe(9.5);
		const row = await orm
			.table("users")
			.select("age", "score")
			.where("id", user.get("id"))
			.first();
		expect(Number(row?.age)).toBe(41);
		expect(Number(row?.score)).toBe(9.5);
	});

	test("object cast stores JSON and reads it back parsed", async () => {
		const user = await CastedUser.create({
			name: "Grace",
			email: "grace@example.com",
			settings: { tags: ["vip", "beta"], profile: { tier: "gold" } },
		});
		expect(user.get("settings")).toEqual({
			tags: ["vip", "beta"],
			profile: { tier: "gold" },
		});
		const reloaded = await CastedUser.find(user.get("id"));
		expect(reloaded?.get("settings")).toEqual({
			tags: ["vip", "beta"],
			profile: { tier: "gold" },
		});
	});

	test("parameterized date cast round-trips as a formatted string", async () => {
		const user = await CastedUser.create({
			name: "Alan",
			email: "alan@example.com",
			joinedAt: new Date(2026, 2, 14, 15, 9, 26),
		});
		// Formatted date casts read/write strings (schema type stays `Date`).
		expect(user.get("joinedAt") as unknown as string).toBe("2026-03-14");
		const reloaded = await CastedUser.find(user.get("id"));
		expect(reloaded?.get("joinedAt") as unknown as string).toBe("2026-03-14");
		await reloaded?.update({ joinedAt: new Date(2027, 0, 2, 8, 0, 0) });
		expect(reloaded?.get("joinedAt") as unknown as string).toBe("2027-01-02");
	});

	test("immutable_datetime hands out defensive copies", async () => {
		const user = await CastedUser.create({
			name: "Edsger",
			email: "edsger@example.com",
			createdAt: new Date("2026-05-05T10:20:30.000Z"),
		});
		const first = user.get("createdAt") as Date;
		expect(first).toBeInstanceOf(Date);
		first.setFullYear(1999);
		const second = user.get("createdAt") as Date;
		expect(second.getFullYear()).not.toBe(1999);
	});

	test("decimal:n cast formats numbers to a fixed scale", async () => {
		class PricedUser extends orm.model("users") {
			static casts = { score: "decimal:2", age: "decimal" } as const;
		}
		const user = await PricedUser.create({
			name: "Katherine",
			email: "katherine@example.com",
			score: 12.5,
			age: 30,
		});
		expect(user.get("score") as unknown as string).toBe("12.50");
		expect(user.get("age") as unknown as string).toBe("30");
	});

	test("parseCastName accepts parameterized names and rejects unknown ones", async () => {
		const { parseCastName } = await import("../../src/model/casts");
		expect(parseCastName("date:Y-m-d")).toEqual({
			base: "date",
			arg: "Y-m-d",
		});
		expect(parseCastName("decimal:3")).toEqual({ base: "decimal", arg: "3" });
		expect(parseCastName("decimal:x")).toBeNull();
		expect(parseCastName("nope:1")).toBeNull();
	});
});

describe("blueprint + migrator extras", () => {
	test("Blueprint column types and alter operations", async () => {
		const ddl = new Orm({ schema: {}, dialect: sqlite(":memory:") });
		const builder = ddl.schemaBuilder();
		await builder.create("widgets", (t) => {
			t.id();
			t.char("code", 12).unique();
			t.tinyInteger("flags").unsigned().default(0);
			t.smallInteger("rank").unsigned();
			t.mediumInteger("size").unsigned();
			t.jsonb("payload").nullable();
			t.foreignId("userId").constrained("users");
			t.foreignIdFor({ __table: "users" }, "ownerId");
			t.string("label", 40);
		});
		const info = await ddl.raw("pragma table_info(widgets)");
		const names = info.rows.map((row) => String(row.name));
		expect(names).toContain("code");
		expect(names).toContain("flags");
		expect(names).toContain("rank");
		expect(names).toContain("size");
		expect(names).toContain("payload");
		expect(names).toContain("userId");
		await builder.alter("widgets", (t) => {
			t.string("extra").nullable();
		});
		await builder.alter("widgets", (t) => {
			t.renameColumn("extra", "renamed");
		});
		await builder.alter("widgets", (t) => {
			t.dropColumn(["renamed", "label"]);
		});
		await builder.alter("widgets", (t) => {
			t.index("rank", "widgets_rank_idx");
		});
		await builder.alter("widgets", (t) => {
			t.dropIndex("widgets_rank_idx");
		});
		// An unnamed inline `unique` has no droppable name — SQLite's
		// auto-index is not addressable, so the error stays explicit.
		await expect(
			builder.alter("widgets", (t) => {
				t.dropUnique("widgets_code_unique");
			}),
		).rejects.toThrow(SchemaError);
	});

	test("SQLite drops named unique indexes and rebuilds for constraints", async () => {
		const rebuildSchema = defineSchema({
			parents: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				label: "string",
			},
			children: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				code: { type: "string", nullable: true },
				parentId: { type: "integer", nullable: true },
			},
		});
		const ddl = new Orm({ schema: rebuildSchema, dialect: sqlite(":memory:") });
		const builder = ddl.schemaBuilder();
		await builder.create("parents", (t) => {
			t.id();
			t.string("label", 40);
		});
		await builder.create("children", (t) => {
			t.id();
			t.string("code", 20);
			t.index("code", "children_code_idx");
			t.unique("code", "children_code_unique");
			t.foreignId("parentId").constrained("parents");
		});
		await ddl.table("parents").insert({ label: "first" });
		const parent = await ddl.table("parents").insert({ label: "second" });
		await ddl.table("children").insert({
			code: "a",
			parentId: parent.id,
		});
		await expect(
			ddl.table("children").insert({ code: "a", parentId: parent.id }),
		).rejects.toThrow();
		await expect(
			ddl.table("children").insert({ code: "b", parentId: 999_999 }),
		).rejects.toThrow();

		// A named unique index drops with `drop index`.
		await builder.alter("children", (t) => {
			t.dropUnique("children_code_unique");
		});
		await ddl.table("children").insert({ code: "a", parentId: parent.id });

		// A named foreign key drops through the table rebuild, which copies
		// the rows and re-creates the remaining indexes.
		await builder.alter("children", (t) => {
			t.dropForeign("children_parentId_foreign");
		});
		const orphan = await ddl
			.table("children")
			.insert({ code: "c", parentId: 999_999 });
		expect(typeof orphan.id).toBe("number");
		const rows = await ddl.table("children").orderBy("id").get();
		expect(rows.count()).toBe(3);
		const indexes = await ddl.raw("pragma index_list('children')");
		expect(indexes.rows.map((row) => String(row.name))).toContain(
			"children_code_idx",
		);
		const foreignKeys = await ddl.raw("pragma foreign_key_list('children')");
		expect(foreignKeys.rows).toHaveLength(0);
	});

	test("self-referential relations alias nested EXISTS and aggregates", async () => {
		const treeSchema = defineSchema({
			nodes: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				parentId: { type: "integer", nullable: true },
				name: "string",
			},
		});
		const treeOrm = new Orm({
			schema: treeSchema,
			dialect: sqlite(":memory:"),
		});
		await treeOrm.schemaBuilder().create("nodes", (t) => {
			t.id();
			t.integer("parentId").nullable();
			t.string("name");
		});
		class Node extends treeOrm.model("nodes") {
			static relations = {
				parent: belongsTo(() => Node, "parentId"),
				children: hasMany(() => Node, "parentId"),
			};
		}
		const root = await Node.create({ name: "root" });
		const rootId = root.get("id") as number;
		const mid = await Node.create({ name: "mid", parentId: rootId });
		const other = await Node.create({ name: "other", parentId: rootId });
		await Node.create({ name: "leaf", parentId: mid.get("id") as number });

		const names = async (query: {
			get(): Promise<{ all(): Array<{ get(c: string): unknown }> }>;
		}) =>
			(await query.get())
				.all()
				.map((row) => row.get("name"))
				.sort();

		// Depth 1: every node with a parent.
		expect(await names(Node.query().whereHas("parent"))).toEqual([
			"leaf",
			"mid",
			"other",
		]);
		// Depth 2: only `leaf` has a grandparent, and the inner EXISTS must
		// reference the *outer* `nodes`, not its own copy.
		expect(await names(Node.query().whereHas("parent.parent"))).toEqual([
			"leaf",
		]);
		// Reverse direction, same nesting problem.
		expect(await names(Node.query().whereHas("children.children"))).toEqual([
			"root",
		]);
		expect(await names(Node.query().whereDoesntHave("parent.parent"))).toEqual([
			"mid",
			"other",
			"root",
		]);

		// The compiled SQL aliases the inner copy so it cannot shadow.
		const sql = Node.query().whereHas("parent.parent").toSQL().sql;
		expect(sql).toContain("nodes__rel_0");

		// A self-referential aggregate correlates through the same alias.
		const counted = await Node.query()
			.orderBy("id")
			.withCount("children")
			.get();
		expect(
			counted.all().map((node) => {
				const row = node as unknown as {
					get(c: string): unknown;
					childrenCount: number;
				};
				return [row.get("name"), row.childrenCount];
			}),
		).toEqual([
			["root", 2],
			["mid", 1],
			["other", 0],
			["leaf", 0],
		]);
		expect(Node.query().withCount("children").toSQL().sql).toContain(
			'from "nodes" as "nodes__rel_0"',
		);

		// Eager loading walks the chain without touching the ambiguity.
		const [leaf] = await Node.query()
			.where("name", "leaf")
			.with("parent.parent")
			.get();
		const loaded = leaf as unknown as {
			parent: { get(c: string): unknown; parent: { get(c: string): unknown } };
		};
		expect(loaded.parent.get("name")).toBe("mid");
		expect(loaded.parent.parent.get("name")).toBe("root");
		void other;
	});

	test("migrator reset/refresh/fresh/pretend", async () => {
		const migrationOrm = new Orm({ schema, dialect: sqlite(":memory:") });
		const migrations = [
			{
				name: "0001_create_widgets",
				async up({
					schema: s,
				}: MigrationContext<typeof schema>): Promise<void> {
					await s.create("migration_widgets", (t) => {
						t.id();
						t.string("name");
					});
				},
				async down({
					schema: s,
				}: MigrationContext<typeof schema>): Promise<void> {
					await s.drop("migration_widgets");
				},
			},
		];
		const migrator = new Migrator(migrationOrm, { migrations });
		const plan = await migrator.pretend();
		expect(plan).toHaveLength(1);
		expect(plan[0]?.statements.join("\n")).toContain("create table");
		expect((await migrator.status()).every((row) => !row.ran)).toBe(true);

		const applied = await migrator.migrate();
		expect(applied.applied).toEqual(["0001_create_widgets"]);
		expect(
			await migrationOrm.schemaBuilder().hasTable("migration_widgets"),
		).toBe(true);

		const reset = await migrator.reset();
		expect(reset).toEqual(["0001_create_widgets"]);
		expect(
			await migrationOrm.schemaBuilder().hasTable("migration_widgets"),
		).toBe(false);

		const refreshed = await migrator.refresh();
		expect(refreshed.applied).toEqual(["0001_create_widgets"]);

		const fresh = await migrator.fresh();
		expect(fresh.applied).toEqual(["0001_create_widgets"]);
		expect(
			await migrationOrm.schemaBuilder().hasTable("migration_widgets"),
		).toBe(true);
	});
});

describe("pruning", () => {
	test("prune deletes eligible rows in chunks", async () => {
		await orm.table("expired_sessions").insert([
			{ token: "a", expiresAt: new Date("2025-01-01T00:00:00Z") },
			{ token: "b", expiresAt: new Date("2025-06-01T00:00:00Z") },
			{ token: "c", expiresAt: new Date("2025-12-31T00:00:00Z") },
			{ token: "d", expiresAt: new Date("2026-06-01T00:00:00Z") },
			{ token: "e", expiresAt: new Date("2027-01-01T00:00:00Z") },
		]);
		const deleted = await ExpiredSession.prune(2);
		expect(deleted).toBe(3);
		expect(await ExpiredSession.query().count()).toBe(2);
	});

	test("prune without a prunable callback throws", async () => {
		await expect(Post.prune()).rejects.toThrow(InvalidModelUsageError);
	});

	test("prune on a soft-deleting model trashes rows", async () => {
		class SoftUser extends orm.model("users") {
			static softDeletes = true;
			static prunable = (query: unknown) => {
				(query as { where(c: string, op: string, v: unknown): unknown }).where(
					"name",
					"like",
					"prune-me%",
				);
			};
		}
		await orm.table("users").insert([
			{ name: "prune-me-1", email: "p1@example.com" },
			{ name: "prune-me-2", email: "p2@example.com" },
			{ name: "keep-me", email: "keep@example.com" },
		]);
		const deleted = await SoftUser.prune();
		expect(deleted).toBe(2);
		expect(
			await SoftUser.query().where("name", "like", "prune-me%").count(),
		).toBe(0);
		expect(
			await SoftUser.withTrashed().where("name", "like", "prune-me%").count(),
		).toBe(2);
		expect(
			await SoftUser.query().where("name", "like", "keep-me%").count(),
		).toBe(1);
	});
});

describe("factories and seeders", () => {
	test("define/state/count/create build persisted models", async () => {
		const users = await User.factory()
			.define({
				email: (index) => `factory${index}@example.com`,
				name: (index) => `Factory ${index}`,
				age: 20,
			})
			.state({ age: 30 })
			.count(3)
			.create({ score: 1.5 });
		expect(users.count()).toBe(3);
		expect(users.all().map((user) => user.get("email"))).toEqual([
			"factory0@example.com",
			"factory1@example.com",
			"factory2@example.com",
		]);
		expect(users.all().every((user) => user.get("age") === 30)).toBe(true);
		expect(users.all()[0]?.get("score")).toBe(1.5);
		expect(users.all()[0]?.get("id")).toBeDefined();
	});

	test("make builds unsaved instances", async () => {
		const before = await User.query().count();
		const built = User.factory()
			.define({ email: (index) => `made${index}@example.com`, name: "Made" })
			.count(2)
			.make();
		expect(built.count()).toBe(2);
		expect(built.all()[0]?.get("id")).toBeUndefined();
		expect(await User.query().count()).toBe(before);
		expect(built.all()[0]?.get("email")).toBe("made0@example.com");
	});

	test("createOne and makeOne", async () => {
		const made = User.factory()
			.define({ email: "one@example.com", name: "One" })
			.makeOne();
		expect(made.get("id")).toBeUndefined();
		const created = await User.factory()
			.define({ email: "two@example.com", name: "Two" })
			.createOne();
		expect(created.get("id")).toBeDefined();
	});

	test("factory instances are Factory values and validate count", () => {
		expect(User.factory()).toBeInstanceOf(Factory);
		expect(() => User.factory().count(-1)).toThrow(SchemaError);
	});

	test("runSeeders runs functions and objects in order", async () => {
		const order: string[] = [];
		await runSeeders(orm, [
			() => {
				order.push("first");
			},
			{
				run: async () => {
					order.push("second");
				},
			},
		]);
		expect(order).toEqual(["first", "second"]);
	});

	test("runSeeders with transaction rolls the whole list back", async () => {
		const email = "seed-rolled-back@example.com";
		await expect(
			runSeeders(
				orm,
				[
					async () => {
						await User.create({ name: "seeded", email });
					},
					async () => {
						throw new Error("seeder failed");
					},
				],
				{ transaction: true },
			),
		).rejects.toThrow("seeder failed");
		expect(await User.query().where("email", email).count()).toBe(0);
		// Without the option the first seeder's row survives.
		await runSeeders(orm, [
			async () => {
				await User.create({ name: "seeded", email });
			},
		]);
		expect(await User.query().where("email", email).count()).toBe(1);
	});
});

describe("multi-connection routing", () => {
	test("static connection routes model queries to the named connection", async () => {
		await AuditEvent.create({ message: "routed" });
		expect(await AuditEvent.query().count()).toBe(1);
		expect(await orm.table("audit_events").count()).toBe(0);
		expect(await orm.connection("audit").table("audit_events").count()).toBe(1);
	});

	test("connection instances share listeners, morph map and macros", async () => {
		expect(orm.connectionNames()).toEqual(["default", "audit"]);
		expect(orm.connection("default")).toBe(orm);
		const statements: string[] = [];
		const unsubscribe = orm.onQuery((event) => statements.push(event.sql));
		await orm
			.connection("audit")
			.table("audit_events")
			.insert({ message: "watched" });
		unsubscribe();
		expect(statements.some((sql) => sql.includes("audit_events"))).toBe(true);
	});

	test("unknown connection throws", () => {
		expect(() => orm.connection("nope")).toThrow(SchemaError);
	});
});

describe("query-builder macros", () => {
	test("orm.macro adds callable builder methods", async () => {
		orm.macro("whereNamedGrace", ((query: {
			where(column: string, operator: string, value: unknown): unknown;
		}) => query.where("name", "=", "Grace")) as never);
		const builder = orm.table("users") as unknown as {
			whereNamedGrace(): {
				get(): Promise<{ all(): Array<{ name: string }> }>;
			};
		};
		const rows = await builder.whereNamedGrace().get();
		expect(rows.all()).toHaveLength(1);
		expect(rows.all()[0]?.name).toBe("Grace");
	});

	test("Model.macro adds instance methods", async () => {
		class MacroUser extends orm.model("users") {}
		MacroUser.macro("displayName", function (this: MacroUser) {
			return `<${String(this.get("name"))}>`;
		});
		const user = await MacroUser.query().first();
		const displayName = (
			user as unknown as { displayName(): string }
		).displayName();
		expect(displayName.startsWith("<")).toBe(true);
		expect(() => MacroUser.macro("save", () => null)).toThrow(
			InvalidModelUsageError,
		);
	});
});

describe("JSON extras", () => {
	beforeAll(async () => {
		await orm.table("users").insert([
			{
				name: "json-a",
				email: "json-a@example.com",
				settings: JSON.stringify({
					tags: ["vip", "beta"],
					profile: { tier: "gold" },
				}),
			},
			{
				name: "json-b",
				email: "json-b@example.com",
				settings: JSON.stringify({
					tags: ["basic"],
					profile: { tier: "silver" },
				}),
			},
		]);
	});

	test("whereJsonContains with a deep path", async () => {
		const byElement = await orm
			.table("users")
			.whereJsonContains("settings", "vip", "$.tags")
			.where("name", "=", "json-a")
			.get();
		expect(byElement.count()).toBe(1);
		const byObject = await orm
			.table("users")
			.whereJsonContains("settings", { tier: "gold" }, "$.profile")
			.where("name", "=", "json-a")
			.get();
		expect(byObject.count()).toBe(1);
		expect(byObject.first()?.name).toBe("json-a");
	});

	test("containsKey / doesntContainKey", async () => {
		const hasKey = await orm
			.table("users")
			.whereJsonContainsKey("settings", "$.profile.tier")
			.where("name", "=", "json-a")
			.get();
		expect(hasKey.count()).toBe(1);
		const missingKey = await orm
			.table("users")
			.whereJsonDoesntContainKey("settings", "$.profile.missing")
			.where("name", "=", "json-a")
			.get();
		expect(missingKey.count()).toBe(1);
	});

	test("whereJsonLength with a path", async () => {
		const rows = await orm
			.table("users")
			.whereJsonLength("settings", ">=", 2, "$.tags")
			.where("name", "=", "json-a")
			.get();
		expect(rows.count()).toBe(1);
	});

	test("whereJsonOverlaps shares elements or key/value pairs", async () => {
		const byPair = await orm
			.table("users")
			.whereJsonOverlaps("settings", { tags: ["vip", "beta"] })
			.where("name", "=", "json-a")
			.get();
		expect(byPair.count()).toBe(1);
		const noOverlap = await orm
			.table("users")
			.whereJsonOverlaps("settings", { tags: ["nope"] })
			.where("name", "=", "json-a")
			.get();
		expect(noOverlap.count()).toBe(0);
	});

	test("invalid JSON paths throw", () => {
		expect(() =>
			orm.table("users").whereJsonContains("settings", "x", "$.a[0]"),
		).toThrow(InvalidQueryError);
	});
});

describe("whereMorphedTo / whereAttachedTo", () => {
	beforeAll(async () => {
		const owner = await User.create({
			name: "morph-owner",
			email: "morph-owner@example.com",
		});
		const post = await Post.create({
			userId: owner.get("id"),
			title: "Morph post",
		});
		await Comment.create({
			body: "comment on post",
			commentableId: post.get("id"),
			commentableType: "posts",
		});
		await Comment.create({
			body: "comment on user",
			commentableId: owner.get("id"),
			commentableType: "users",
		});
	});

	test("whereMorphedTo accepts an instance, a class and an alias", async () => {
		const post = await Post.query().firstOrFail();
		const byInstance = await Comment.query()
			.whereMorphedTo("commentable", post)
			.get();
		expect(byInstance.count()).toBe(1);
		expect(byInstance.first()?.get("body")).toBe("comment on post");
		const byClass = await Comment.query()
			.whereMorphedTo("commentable", Post)
			.get();
		expect(byClass.count()).toBe(1);
		const byAlias = await Comment.query()
			.whereMorphedTo("commentable", "users")
			.get();
		expect(byAlias.count()).toBe(1);
		expect(byAlias.first()?.get("body")).toBe("comment on user");
	});

	test("whereNotMorphedTo returns the complement", async () => {
		const post = await Post.query().firstOrFail();
		const others = await Comment.query()
			.whereNotMorphedTo("commentable", post)
			.get();
		expect(others.count()).toBe(1);
		expect(others.first()?.get("body")).toBe("comment on user");
	});

	test("whereAttachedTo follows belongsTo, hasMany, morphTo and pivots", async () => {
		const user = await User.query()
			.where("name", "=", "morph-owner")
			.firstOrFail();
		const post = await Post.query().firstOrFail();
		const role = await Role.create({ name: "morph-role" });
		await user.relation("roles").attach(role.get("id"), {
			note: "attached",
			grantedAt: new Date(2026, 3, 1),
		});

		// belongsTo: Post -> User
		const userPosts = await Post.query().whereAttachedTo(user).get();
		expect(userPosts.count()).toBe(1);

		// hasMany: User -> Post
		const postOwners = await User.query().whereAttachedTo(post).get();
		expect(postOwners.count()).toBe(1);
		expect(postOwners.first()?.get("id")).toBe(user.get("id"));

		// morphTo: Comment -> Post
		const comments = await Comment.query().whereAttachedTo(post).get();
		expect(comments.count()).toBe(1);

		// belongsToMany: User -> Role
		const roleUsers = await User.query().whereAttachedTo(role).get();
		expect(roleUsers.count()).toBe(1);
		expect(roleUsers.first()?.get("id")).toBe(user.get("id"));
	});

	test("whereNotAttachedTo is the complement", async () => {
		const post = await Post.query().firstOrFail();
		const notOwners = await User.query().whereNotAttachedTo(post).get();
		expect(
			notOwners.all().every((user) => user.get("name") !== "morph-owner"),
		).toBe(true);
	});
});

describe("custom pivot models (using)", () => {
	test("eager-loaded pivots are custom instances with casts", async () => {
		const user = await User.query()
			.where("name", "=", "morph-owner")
			.firstOrFail();
		const loaded = await User.query()
			.where("id", user.get("id"))
			.with("roles")
			.firstOrFail();
		const roles = (
			loaded as unknown as {
				roles: { all(): Array<{ pivot: Membership }> };
			}
		).roles.all();
		expect(roles).toHaveLength(1);
		const pivot = roles[0]?.pivot;
		expect(pivot).toBeInstanceOf(Membership);
		if (pivot === undefined) throw new Error("pivot missing");
		expect(pivot.get("note")).toBe("attached");
		expect(pivot.get("grantedAt")).toBe("2026-04-01");
	});

	test("attach prepares values through the pivot casts", async () => {
		const user = await User.create({
			name: "pivot-cast",
			email: "pivot-cast@example.com",
		});
		const role = await Role.query().firstOrFail();
		await user.relation("roles").attach(role.get("id"), {
			note: "casted",
			grantedAt: new Date(2026, 6, 9),
		});
		const row = await orm.raw(
			"select note, grantedAt from role_user where userId = ?",
			[user.get("id")],
		);
		expect(row.rows[0]?.note).toBe("casted");
		// date:Y-m-d stores the formatted string.
		expect(String(row.rows[0]?.grantedAt)).toBe("2026-07-09");
	});

	test("Pivot base class is exported", () => {
		expect(typeof Pivot).toBe("function");
	});
});
