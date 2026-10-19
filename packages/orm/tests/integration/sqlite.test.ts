// Full-stack integration tests on SQLite (in-memory) — both execution paths.
//
// Every public API documented in the README appears at least once here, and
// every assertion runs against a real database through the real drivers.

import { beforeAll, describe, expect, test } from "bun:test";
import type { Migration } from "../../src/index";
import {
	belongsTo,
	belongsToMany,
	defineSchema,
	hasMany,
	hasOne,
	InvalidQueryError,
	Migrator,
	ModelNotFoundError,
	NotNullConstraintError,
	Orm,
	QueryError,
	RelationNotLoadedError,
	UniqueConstraintError,
} from "../../src/index";
import { sqlite } from "../../src/sqlite";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		age: { type: "integer", nullable: true },
		active: { type: "boolean", default: true },
		settings: { type: "json", nullable: true },
		balance: { type: "decimal", nullable: true },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		published: { type: "boolean", default: false },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	profiles: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		bio: { type: "text", nullable: true },
	},
	roles: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	role_user: {
		userId: "integer",
		roleId: "integer",
	},
});

const orm = new Orm({ schema, dialect: sqlite(":memory:") });

class User extends orm.model("users") {
	static relations = {
		posts: hasMany(() => Post, "userId"),
		publishedPosts: hasMany(() => Post, "userId"),
		profile: hasOne(() => Profile, "userId"),
		roles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
		}),
	};
	static casts = { active: "boolean", settings: "json" } as const;
	static fillable = ["name", "email", "age", "active", "settings"] as const;
	static hidden = ["email"] as const;
}

class Post extends orm.model("posts") {
	static relations = {
		author: belongsTo(() => User, "userId"),
	};
	static casts = { published: "boolean" } as const;
}

class Profile extends orm.model("profiles") {
	static relations = {
		user: belongsTo(() => User, "userId"),
	};
}

class Role extends orm.model("roles") {}

async function seed(): Promise<void> {
	const schemaBuilder = orm.schemaBuilder();
	await schemaBuilder.create("users", (t) => {
		t.id();
		t.string("name", 120);
		t.string("email", 190).unique();
		t.integer("age").nullable();
		t.boolean("active").default(true);
		t.json("settings").nullable();
		t.decimal("balance", 10, 2).nullable();
		t.timestamps();
	});
	await schemaBuilder.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title", 200);
		t.integer("views").default(0);
		t.boolean("published").default(false);
		t.timestamps();
	});
	await schemaBuilder.create("profiles", (t) => {
		t.id();
		t.integer("userId");
		t.text("bio").nullable();
	});
	await schemaBuilder.create("roles", (t) => {
		t.id();
		t.string("name", 60);
	});
	await schemaBuilder.create("role_user", (t) => {
		t.integer("userId");
		t.integer("roleId");
	});
}

let adaId = 0;
let graceId = 0;

beforeAll(async () => {
	await seed();
	const ada = await User.create({
		name: "Ada",
		email: "ada@example.com",
		age: 36,
	});
	const grace = await User.create({
		name: "Grace",
		email: "grace@example.com",
		age: 45,
		active: false,
		settings: { theme: "dark", nested: { a: 1 } },
	});
	adaId = ada.get("id") as number;
	graceId = grace.get("id") as number;
	await Post.create({
		userId: adaId,
		title: "Hello world",
		views: 10,
		published: true,
	});
	await Post.create({
		userId: adaId,
		title: "Draft",
		views: 3,
		published: false,
	});
	await Post.create({
		userId: graceId,
		title: "Compilers",
		views: 99,
		published: true,
	});
	await Profile.create({ userId: adaId, bio: "First programmer" });
	const admin = await Role.create({ name: "admin" });
	await Role.create({ name: "editor" });
	const adminId = admin.get("id") as number;
	await orm.table("role_user").insert({ userId: adaId, roleId: adminId });
});

describe("rows path", () => {
	test("insert returns the generated id and reads back converted values", async () => {
		const result = await orm
			.table("users")
			.insert({ name: "Alan", email: "alan@example.com", age: 41 } as never);
		expect(typeof result.id).toBe("number");
		const row = await orm
			.table("users")
			.where("email", "alan@example.com")
			.first();
		expect(row).not.toBeNull();
		expect(row?.active).toBe(true); // boolean default converted from 1
		expect(row?.createdAt).toBeNull();
		await orm
			.table("users")
			.where("id", result.id as number)
			.delete();
	});

	test("insertMany / update / delete report affected rows", async () => {
		const inserted = await orm.table("posts").insertMany([
			{ userId: graceId, title: "A" },
			{ userId: graceId, title: "B" },
		]);
		expect(inserted).toBe(2);
		const updated = await orm
			.table("posts")
			.whereIn("title", ["A", "B"])
			.update({ views: 7 } as never);
		expect(updated).toBe(2);
		const deleted = await orm
			.table("posts")
			.whereIn("title", ["A", "B"])
			.delete();
		expect(deleted).toBe(2);
	});

	test("where family filters correctly", async () => {
		const adults = await orm.table("users").where("age", ">=", 40).get();
		expect(
			adults
				.map((row) => row.name)
				.sort()
				.all(),
		).toEqual(["Grace"]);
		const named = await orm
			.table("users")
			.where((group) => group.where("name", "Ada").orWhere("name", "Grace"))
			.get();
		expect(named).toHaveLength(2);
		const notAda = await orm
			.table("users")
			.whereNot((group) => group.where("name", "Ada"))
			.get();
		expect(notAda.map((row) => row.name).all()).toEqual(["Grace"]);
		const between = await orm
			.table("users")
			.whereBetween("age", [40, 50])
			.get();
		expect(
			between
				.map((row) => row.name)
				.sort()
				.all(),
		).toEqual(["Grace"]);
		const inactive = await orm.table("users").where("active", false).get();
		expect(inactive.map((row) => row.name).all()).toEqual(["Grace"]);
		const nullAges = await orm.table("users").whereNull("age").get();
		expect(nullAges).toHaveLength(0);
		const inList = await orm
			.table("users")
			.whereIn("id", [adaId, graceId])
			.get();
		expect(inList).toHaveLength(2);
		const emptyIn = await orm.table("users").whereIn("id", []).get();
		expect(emptyIn).toHaveLength(0);
		const emptyNotIn = await orm.table("users").whereNotIn("id", []).get();
		expect(emptyNotIn.length).toBeGreaterThan(0);
	});

	test("orderBy / limit / offset / pluck / exists / firstOrFail", async () => {
		const ordered = await orm
			.table("users")
			.orderBy("age", "desc")
			.limit(1)
			.offset(0)
			.get();
		expect(ordered[0]?.name).toBe("Grace");
		const names = await orm.table("users").orderBy("id").pluck("name");
		expect(names.slice(0, 2).all()).toEqual(["Ada", "Grace"]);
		expect(await orm.table("users").where("name", "Ada").exists()).toBe(true);
		expect(await orm.table("users").where("name", "Nobody").exists()).toBe(
			false,
		);
		await expect(
			orm.table("users").where("name", "Nobody").firstOrFail(),
		).rejects.toThrow(ModelNotFoundError);
	});

	test("joins keep base columns and support joined-table filters", async () => {
		const rows = await orm
			.table("posts")
			.join("users", "posts.userId", "=", "users.id")
			.where("users.active", true)
			.orderBy("posts.views", "desc")
			.get();
		expect(rows).toHaveLength(2);
		expect(rows[0]?.title).toBe("Hello world");
		expect("name" in (rows[0] ?? {})).toBe(false);
	});

	test("groupBy + having + group-aware count", async () => {
		const groups = await orm
			.table("posts")
			.select("userId")
			.groupBy("userId")
			.get();
		expect(groups.length).toBe(2);
		const groupCount = await orm.table("posts").groupBy("userId").count();
		expect(groupCount).toBe(2);
		const having = await orm
			.table("posts")
			.select("userId")
			.groupBy("userId")
			.havingRaw("count(*) > ?", [1])
			.get();
		expect(having).toHaveLength(1);
		expect(having[0]?.userId).toBe(adaId);
	});

	test("aggregates", async () => {
		expect(await orm.table("posts").sum("views")).toBe(112);
		expect(await orm.table("posts").min("views")).toBe(3);
		expect(await orm.table("posts").max("views")).toBe(99);
		expect(await orm.table("posts").avg("views")).toBeCloseTo(112 / 3, 5);
		expect(await orm.table("posts").count()).toBe(3);
	});

	test("paginate / chunk / cursor", async () => {
		const page = await orm.table("posts").orderBy("id").paginate(2, 1);
		expect(page.total).toBe(3);
		expect(page.data).toHaveLength(2);
		expect(page.lastPage).toBe(2);
		expect(page.hasMore).toBe(true);
		const page2 = await orm.table("posts").orderBy("id").paginate(2, 2);
		expect(page2.data).toHaveLength(1);
		const seen: string[] = [];
		await orm.table("posts").chunk(2, (rows) => {
			for (const row of rows) seen.push(row.title);
		});
		expect(seen).toHaveLength(3);
		const streamed: string[] = [];
		for await (const row of orm.table("posts").cursor(1)) {
			streamed.push(row.title);
		}
		expect(streamed).toHaveLength(3);
	});

	test("upsert inserts then updates on conflict", async () => {
		await orm
			.table("users")
			.upsert({ email: "upsert@example.com", name: "First" } as never, {
				conflictOn: "email",
				update: ["name"],
			});
		await orm
			.table("users")
			.upsert({ email: "upsert@example.com", name: "Second" } as never, {
				conflictOn: "email",
				update: ["name"],
			});
		const row = await orm
			.table("users")
			.where("email", "upsert@example.com")
			.first();
		expect(row?.name).toBe("Second");
		const total = await orm
			.table("users")
			.where("email", "upsert@example.com")
			.count();
		expect(total).toBe(1);
		await orm.table("users").where("email", "upsert@example.com").delete();
	});

	test("unique violations surface as UniqueConstraintError", async () => {
		await expect(
			orm
				.table("users")
				.insert({ name: "Clone", email: "ada@example.com" } as never),
		).rejects.toThrow(UniqueConstraintError);
	});

	test("raw SQL with bindings, and placeholder validation", async () => {
		const result = await orm.raw("select count(*) as total from posts");
		expect(Number((result.rows[0] as { total: unknown }).total)).toBe(3);
		expect(() => orm.raw("select ? ?", [1])).toThrow(QueryError);
	});

	test("unknown tables and columns are rejected before hitting the database", () => {
		expect(() => orm.table("nope" as never)).toThrow(InvalidQueryError);
		expect(() => orm.table("users").where("nope" as never, 1 as never)).toThrow(
			InvalidQueryError,
		);
	});

	test("toSQL exposes the compiled statement", () => {
		const compiled = orm.table("users").where("id", 1).toSQL();
		expect(compiled.sql).toContain("select");
		expect(compiled.sql.toLowerCase()).toContain("users");
		expect(compiled.parameters).toEqual([1]);
	});

	test("when() applies conditional branches", async () => {
		const withFilter = await orm
			.table("users")
			.when(true, (query) => query.where("name", "Ada"))
			.get();
		expect(withFilter).toHaveLength(1);
		const withoutFilter = await orm
			.table("users")
			.when(false, (query) => query.where("name", "Ada"))
			.get();
		expect(withoutFilter.length).toBeGreaterThan(1);
	});
});

describe("model path", () => {
	test("create fills timestamps and applies casts", async () => {
		const user = await User.create({
			name: "Linus",
			email: "linus@example.com",
			settings: { os: "linux" },
			balance: "10.50",
		} as never);
		expect(typeof user.get("id")).toBe("number");
		expect(user.get("settings")).toEqual({ os: "linux" });
		expect(user.get("active")).toBe(true);
		// `balance` is not fillable — mass assignment dropped it.
		expect(user.get("balance")).toBeNull();
		expect(user.get("createdAt")).toBeInstanceOf(Date);
		expect(user.get("updatedAt")).toBeInstanceOf(Date);
		expect(user.isDirty()).toBe(false);
	});

	test("set() bypasses mass-assignment protection and save() persists casts", async () => {
		const user = await User.create({
			name: "Guarded",
			email: "guarded@example.com",
		});
		user.set("balance", "12.34");
		await user.save();
		const reloaded = await User.find(user.get("id"));
		expect(reloaded?.get("balance")).toBe("12.34");
	});

	test("unknown columns in mass assignment throw", async () => {
		await expect(User.create({ bogus: 1 } as never)).rejects.toThrow(
			InvalidQueryError,
		);
	});

	test("dirty tracking is exact and saves only dirty attributes", async () => {
		const user = await User.create({
			name: "Dirty",
			email: "dirty@example.com",
		});
		expect(user.isDirty()).toBe(false);
		user.set("name", "Dirty Two");
		expect(user.isDirty()).toBe(true);
		expect(user.getDirty()).toEqual({ name: "Dirty Two" });
		user.set("name", "Dirty");
		expect(user.isDirty()).toBe(false);
		user.set("name", "Dirty Three");
		await user.save();
		expect(user.isDirty()).toBe(false);
		const reloaded = await User.find(user.get("id"));
		expect(reloaded?.get("name")).toBe("Dirty Three");
	});

	test("update() mass-assigns and saves in one step", async () => {
		const user = await User.create({
			name: "Updater",
			email: "updater@example.com",
		});
		await user.update({ name: "Updated", age: 31 });
		expect(user.get("name")).toBe("Updated");
		expect(user.get("age")).toBe(31);
	});

	test("refresh re-reads from the database; delete removes the row", async () => {
		const user = await User.create({ name: "Gone", email: "gone@example.com" });
		await orm
			.table("users")
			.where("id", user.get("id"))
			.update({ name: "Gone2" } as never);
		await user.refresh();
		expect(user.get("name")).toBe("Gone2");
		await user.delete();
		expect(await User.find(user.get("id"))).toBeNull();
	});

	test("find / findOrFail / findMany / all", async () => {
		expect((await User.find(adaId))?.get("name")).toBe("Ada");
		await expect(User.findOrFail(99999)).rejects.toThrow(ModelNotFoundError);
		const many = await User.findMany([adaId, graceId]);
		expect(many).toHaveLength(2);
		const all = await User.all();
		expect(all.length).toBeGreaterThanOrEqual(2);
	});

	test("createMany inserts in one statement", async () => {
		const created = await User.createMany([
			{ name: "Bulk A", email: "bulk-a@example.com" },
			{ name: "Bulk B", email: "bulk-b@example.com" },
		]);
		expect(created).toHaveLength(2);
		expect(created[0]?.get("id")).toBeLessThan(created[1]?.get("id") as number);
	});

	test("toJSON hides configured columns and includes loaded relations", async () => {
		const user = await User.query()
			.with("posts")
			.where("id", adaId)
			.firstOrFail();
		const json = user.toJSON() as Record<string, unknown>;
		expect("email" in json).toBe(false);
		expect(Array.isArray(json.posts)).toBe(true);
		expect(JSON.parse(JSON.stringify(user))).toHaveProperty("posts");
	});
});

describe("relations", () => {
	test("eager loads hasMany / hasOne / belongsToMany without N+1", async () => {
		const queries: string[] = [];
		const off = orm.onQuery((event) => queries.push(event.sql));
		const users = await User.query()
			.with("posts", "profile", "roles")
			.whereIn("id", [adaId, graceId])
			.orderBy("id")
			.get();
		off();
		const ada = users[0]!;
		const grace = users[1]!;
		expect(ada.posts).toHaveLength(2);
		expect(ada.profile?.get("bio")).toBe("First programmer");
		expect(ada.roles.map((role) => role.get("name")).all()).toEqual(["admin"]);
		expect(grace.posts.map((post) => post.get("title")).all()).toEqual([
			"Compilers",
		]);
		expect(grace.profile).toBeNull();
		expect(grace.roles).toHaveLength(0);
		// 1 users query + 4 relation queries (posts, profiles, pivot, roles)
		// — never one query per user (N+1).
		expect(
			queries.filter((sql) => sql.toLowerCase().startsWith("select")),
		).toHaveLength(5);
	});

	test("belongsTo eager loading resolves the owning row", async () => {
		const posts = await Post.query().with("author").orderBy("id").get();
		expect(posts[0]?.author?.get("name")).toBe("Ada");
	});

	test("nested eager paths (posts.author)", async () => {
		const users = await User.query()
			.with("posts.author")
			.whereIn("id", [adaId, graceId])
			.orderBy("id")
			.get();
		const adaPosts = users[0]!.posts;
		expect(adaPosts).toHaveLength(2);
		expect(adaPosts.every((post) => post.author?.get("name") === "Ada")).toBe(
			true,
		);
	});

	test("withCount adds typed relation counts", async () => {
		const users = await User.query()
			.withCount("posts")
			.whereIn("id", [adaId, graceId])
			.orderBy("id")
			.get();
		expect(users[0]?.postsCount).toBe(2);
		expect(users[1]?.postsCount).toBe(1);
	});

	test("whereHas filters by related rows (all four kinds)", async () => {
		const publishedAuthors = await User.query()
			.whereHas("posts", (group) => group.where("published", true))
			.orderBy("id")
			.get();
		expect(publishedAuthors.map((user) => user.get("name")).all()).toEqual([
			"Ada",
			"Grace",
		]);
		const anyPosts = await User.query().whereHas("posts").orderBy("id").get();
		expect(anyPosts.map((user) => user.get("name")).all()).toEqual([
			"Ada",
			"Grace",
		]);
		const admins = await User.query()
			.whereHas("roles", (group) => group.where("name", "admin"))
			.get();
		expect(admins.map((user) => user.get("name")).all()).toEqual(["Ada"]);
		const profiled = await User.query().whereHas("profile").orderBy("id").get();
		expect(profiled.map((user) => user.get("name")).all()).toEqual(["Ada"]);
	});

	test("accessing a non-loaded relation throws RelationNotLoadedError", async () => {
		const user = await User.find(adaId);
		expect(() => user?.getRelation("posts")).toThrow(RelationNotLoadedError);
		expect(() => User.query().with("nope" as never)).toThrow(InvalidQueryError);
	});
});

describe("transactions", () => {
	test("commit persists; thrown callbacks roll back every statement", async () => {
		await orm.transaction(async () => {
			await User.create({ name: "TxOne", email: "tx1@example.com" });
		});
		expect(
			await orm.table("users").where("email", "tx1@example.com").count(),
		).toBe(1);
		await orm
			.transaction(async () => {
				await User.create({ name: "TxTwo", email: "tx2@example.com" });
				await orm
					.table("posts")
					.insert({ userId: adaId, title: "tx post" } as never);
				throw new Error("boom");
			})
			.catch(() => undefined);
		expect(
			await orm.table("users").where("email", "tx2@example.com").count(),
		).toBe(0);
		expect(await orm.table("posts").where("title", "tx post").count()).toBe(0);
	});

	test("inTransaction reflects the ambient context", async () => {
		expect(orm.inTransaction()).toBe(false);
		await orm.transaction(async () => {
			expect(orm.inTransaction()).toBe(true);
		});
		expect(orm.inTransaction()).toBe(false);
	});

	test("nested transactions roll back to savepoints", async () => {
		await orm.transaction(async () => {
			await User.create({ name: "Outer", email: "outer@example.com" });
			await orm
				.transaction(async () => {
					await User.create({ name: "Inner", email: "inner@example.com" });
					throw new Error("inner failure");
				})
				.catch(() => undefined);
			await User.create({ name: "Outer2", email: "outer2@example.com" });
		});
		expect(
			await orm.table("users").where("email", "outer@example.com").count(),
		).toBe(1);
		expect(
			await orm.table("users").where("email", "outer2@example.com").count(),
		).toBe(1);
		expect(
			await orm.table("users").where("email", "inner@example.com").count(),
		).toBe(0);
	});

	test("bounded retries on retryable transaction errors", async () => {
		let attempts = 0;
		const result = await orm.transaction(
			async () => {
				attempts += 1;
				if (attempts === 1) {
					throw Object.assign(new Error("database is locked"), {
						code: "SQLITE_BUSY",
					});
				}
				await User.create({ name: "Retry", email: "retry@example.com" });
				return "done";
			},
			{ retries: 1 },
		);
		expect(result).toBe("done");
		expect(attempts).toBe(2);
		expect(
			await orm.table("users").where("email", "retry@example.com").count(),
		).toBe(1);
	});

	test("query events report every statement, savepoints included", async () => {
		const sql: string[] = [];
		const off = orm.onQuery((event) => sql.push(event.sql));
		await orm.transaction(async () => {
			await User.query().where("id", adaId).first();
			await orm.transaction(async () => {
				await User.query().where("id", graceId).first();
			});
		});
		off();
		expect(
			sql.some((statement) => statement.toLowerCase().includes("select")),
		).toBe(true);
		expect(
			sql.some((statement) => statement.toLowerCase().includes("savepoint")),
		).toBe(true);
		expect(
			sql.some((statement) =>
				statement.toLowerCase().includes("release savepoint"),
			),
		).toBe(true);
	});
});

describe("migrations", () => {
	const migrations: Array<Migration<typeof schema>> = [
		{
			name: "001_create_teams",
			async up({ schema: ddl }) {
				await ddl.create("teams", (t) => {
					t.id();
					t.string("name", 80);
				});
			},
			async down({ schema: ddl }) {
				await ddl.drop("teams");
			},
		},
		{
			name: "002_add_slug",
			async up({ schema: ddl, execute }) {
				await ddl.alter("teams", (t) => {
					t.string("slug", 80).nullable();
				});
				await execute("update teams set slug = ?", ["unknown"]);
			},
			async down({ schema: ddl }) {
				await ddl.alter("teams", (t) => {
					t.dropColumn("slug");
				});
			},
		},
	];

	test("migrate applies pending batches once; rollback reverses them", async () => {
		const migrator = new Migrator(orm, { migrations });
		const first = await migrator.migrate();
		expect(first.applied).toEqual(["001_create_teams", "002_add_slug"]);
		expect(first.batch).toBe(1);
		const second = await migrator.migrate();
		expect(second.applied).toEqual([]);
		const status = await migrator.status();
		expect(status.map((entry) => entry.ran)).toEqual([true, true]);
		const rolledBack = await migrator.rollback();
		expect(rolledBack).toEqual(["002_add_slug", "001_create_teams"]);
		const finalStatus = await migrator.status();
		expect(finalStatus.every((entry) => !entry.ran)).toBe(true);
		expect(await orm.schemaBuilder().hasTable("teams")).toBe(false);
		// Re-apply so the schema is deterministic if the file is re-run.
		await migrator.migrate();
		expect(await orm.schemaBuilder().hasTable("teams")).toBe(true);
	});

	test("schema builder supports alter + rename column", async () => {
		const ddl = orm.schemaBuilder();
		await ddl.create("tmp_things", (t) => {
			t.id();
			t.string("label", 40);
		});
		await ddl.alter("tmp_things", (t) => {
			t.string("note", 80).nullable();
			t.renameColumn("label", "title");
		});
		const columns = await orm
			.raw("pragma table_info(tmp_things)")
			.then((result) =>
				result.rows.map((row) => (row as { name: string }).name),
			);
		expect(columns).toContain("note");
		expect(columns).toContain("title");
		expect(columns).not.toContain("label");
		await ddl.dropIfExists("tmp_things");
		expect(await ddl.hasTable("tmp_things")).toBe(false);
	});
});

describe("errors", () => {
	test("NOT NULL violations are classified", async () => {
		await expect(
			orm.raw("insert into users (email) values (?)", ["no-name@example.com"]),
		).rejects.toThrow(NotNullConstraintError);
	});

	test("unique violations carry the failing statement", async () => {
		try {
			await orm
				.table("users")
				.insert({ name: "Clone", email: "ada@example.com" } as never);
			throw new Error("expected a unique violation");
		} catch (error) {
			expect(error).toBeInstanceOf(UniqueConstraintError);
			expect((error as UniqueConstraintError).code).toBe("UNIQUE_CONSTRAINT");
			expect((error as UniqueConstraintError).sql.toLowerCase()).toContain(
				"insert into",
			);
		}
	});
});
