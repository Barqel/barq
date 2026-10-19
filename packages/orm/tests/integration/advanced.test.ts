// Advanced Eloquent-parity suite.
//
// Covers the post-collection batch:
//   1. collections (collect.js-backed)
//   2. relation write managers
//   3. instance load/loadMissing/loadCount/loadSum-family
//   4. global + local scopes
//   5. broad query-builder surface (dates, JSON, column comparisons, raw,
//      exists, cursors, lazy/chunk-by-id, upserts, truncate, incrementEach)
//   6. lifecycle helpers (touch/fresh/changes/quiet/push/is/only)
//   7. advanced casts (collection, stringable, enum, encrypted arrays,
//      class-based custom casts)

import { beforeAll, describe, expect, test } from "bun:test";
import {
	belongsTo,
	belongsToMany,
	CastError,
	Collection,
	collect,
	defineSchema,
	type GlobalScope,
	hasMany,
	hasManyThrough,
	type LocalScope,
	morphTo,
	Orm,
	raw,
} from "../../src/index";
import { sqlite } from "../../src/sqlite";

const schema = defineSchema({
	countries: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		code: { type: "string", nullable: true },
		status: { type: "string", default: "active" },
		active: { type: "boolean", default: true },
		settings: { type: "json", nullable: true },
		secret: { type: "json", nullable: true },
		prefs: { type: "json", nullable: true },
		nickname: { type: "string", nullable: true },
		countryId: { type: "integer", nullable: true },
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
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		body: "string",
		postId: "integer",
		commentableId: { type: "integer", nullable: true },
		commentableType: { type: "string", nullable: true },
	},
	tags: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	scratch: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		value: "string",
	},
});

const orm = new Orm({
	schema,
	dialect: sqlite(":memory:"),
	encryptionKey: "advanced-suite-key",
});

// biome-ignore lint/complexity/noStaticOnlyClass: class-based casts are part of the public contract
class UpperCast {
	static get(value: unknown): unknown {
		return value === null || value === undefined
			? value
			: String(value).toUpperCase();
	}

	static set(value: unknown): unknown {
		return value === null || value === undefined
			? value
			: String(value).toLowerCase();
	}
}

class Country extends orm.model("countries") {
	static fillable = ["name"] as const;
	static relations = {
		users: hasMany(() => User, "countryId"),
		posts: hasManyThrough(
			() => Post,
			() => User,
			"countryId",
			"userId",
		),
	};
}

class User extends orm.model("users") {
	static fillable = [
		"name",
		"email",
		"code",
		"status",
		"active",
		"settings",
		"secret",
		"prefs",
		"nickname",
		"countryId",
	] as const;
	static casts = {
		settings: "collection",
		secret: "encrypted:array",
		prefs: "encrypted:collection",
		nickname: "stringable",
		code: UpperCast,
		status: {
			enum: { Active: "active", Banned: "banned", Invited: "invited" },
		},
	} as const;
	static scopes: {
		named: LocalScope<typeof User, [string]>;
		activeOnly: LocalScope<typeof User>;
	} = {
		named: (query, name) => {
			query.where("name", name);
		},
		activeOnly: (query) => {
			query.where("active", true);
		},
	};
	static relations = {
		posts: hasMany(() => Post, "userId"),
		country: belongsTo(() => Country, "countryId"),
	};
}

class ScopedUser extends orm.model("users") {
	static globalScopes: Record<string, GlobalScope<typeof ScopedUser>> = {
		active: (query) => {
			query.where("active", true);
		},
	};
}

class Post extends orm.model("posts") {
	static fillable = ["userId", "title", "views", "published"] as const;
	static touches = ["author"] as const;
	static relations = {
		author: belongsTo(() => User, "userId"),
		tags: belongsToMany(() => Tag, {
			through: "post_tags",
			foreignPivotKey: "postId",
			relatedPivotKey: "tagId",
		}),
		comments: hasMany(() => Comment, "postId"),
	};
}

class Comment extends orm.model("comments") {
	static fillable = [
		"body",
		"postId",
		"commentableId",
		"commentableType",
	] as const;
	static relations = {
		post: belongsTo(() => Post, "postId"),
		commentable: morphTo("commentable", () => ({
			posts: Post,
			users: User,
		})),
	};
}

class Tag extends orm.model("tags") {
	static fillable = ["name"] as const;
}

class Scratch extends orm.model("scratch") {
	static fillable = ["value"] as const;
}

const ids = {
	egypt: 0,
	france: 0,
	ada: 0,
	grace: 0,
	adaFirst: 0,
	adaSecond: 0,
	gracePost: 0,
	ts: 0,
	sql: 0,
	rust: 0,
};

async function seed(): Promise<void> {
	const ddl = orm.schemaBuilder();
	await ddl.create("countries", (t) => {
		t.id();
		t.string("name", 120);
	});
	await ddl.create("users", (t) => {
		t.id();
		t.string("name", 120);
		t.string("email", 190).unique();
		t.string("code", 60).nullable();
		t.string("status", 40).default("active");
		t.boolean("active").default(true);
		t.json("settings").nullable();
		t.json("secret").nullable();
		t.json("prefs").nullable();
		t.string("nickname", 120).nullable();
		t.integer("countryId").nullable();
		t.timestamps();
	});
	await ddl.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title", 190);
		t.integer("views").default(0);
		t.boolean("published").default(false);
		t.timestamps();
	});
	await ddl.create("comments", (t) => {
		t.id();
		t.string("body", 190);
		t.integer("postId");
		t.integer("commentableId").nullable();
		t.string("commentableType", 60).nullable();
	});
	await ddl.create("tags", (t) => {
		t.id();
		t.string("name", 60);
	});
	await ddl.create("post_tags", (t) => {
		t.integer("postId");
		t.integer("tagId");
		t.string("note", 120).nullable();
	});
	await ddl.create("scratch", (t) => {
		t.id();
		t.string("value", 60).unique();
	});

	const egypt = await Country.create({ name: "Egypt" });
	const france = await Country.create({ name: "France" });
	ids.egypt = egypt.get("id") as number;
	ids.france = france.get("id") as number;

	const ada = await User.create({
		name: "Ada",
		email: "ada@advanced.test",
		countryId: ids.egypt,
	});
	const grace = await User.create({
		name: "Grace",
		email: "grace@advanced.test",
		countryId: ids.france,
	});
	ids.ada = ada.get("id") as number;
	ids.grace = grace.get("id") as number;

	const p1 = await Post.create({
		userId: ids.ada,
		title: "Analytical engine",
		views: 40,
		published: true,
	});
	const p2 = await Post.create({
		userId: ids.ada,
		title: "Notes",
		views: 2,
		published: false,
	});
	const p3 = await Post.create({
		userId: ids.grace,
		title: "Compilers",
		views: 70,
		published: true,
	});
	ids.adaFirst = p1.get("id") as number;
	ids.adaSecond = p2.get("id") as number;
	ids.gracePost = p3.get("id") as number;

	const ts = await Tag.create({ name: "ts" });
	const sql = await Tag.create({ name: "sql" });
	const rust = await Tag.create({ name: "rust" });
	ids.ts = ts.get("id") as number;
	ids.sql = sql.get("id") as number;
	ids.rust = rust.get("id") as number;

	await Comment.create({
		body: "first",
		postId: ids.adaFirst,
		commentableId: ids.adaFirst,
		commentableType: "posts",
	});
	await Comment.create({
		body: "second",
		postId: ids.adaFirst,
		commentableId: ids.adaFirst,
		commentableType: "posts",
	});
	await Comment.create({
		body: "user comment",
		postId: ids.adaFirst,
		commentableId: ids.ada,
		commentableType: "users",
	});
}

beforeAll(async () => {
	await seed();
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

describe("collections", () => {
	test("collect() exposes chainable Eloquent helpers", () => {
		const numbers = collect([3, 1, 2, 2]);
		expect(numbers).toBeInstanceOf(Collection);
		expect(numbers.sum()).toBe(8);
		expect(numbers.avg()).toBe(2);
		expect(numbers.min()).toBe(1);
		expect(numbers.max()).toBe(3);
		expect(numbers.sortBy((value) => value).toArray()).toEqual([1, 2, 2, 3]);
		expect(numbers.unique().toArray()).toEqual([3, 1, 2]);
		expect(collect<number>([]).avg()).toBeNull();
		expect(collect<number>([]).min()).toBeNull();
		expect(collect<number>([]).max()).toBeNull();

		const mapped = numbers.map((value) => value * 2);
		expect(mapped).toBeInstanceOf(Collection);
		expect(mapped.sum()).toBe(16);
		expect(numbers.filter((value) => value > 1).all()).toEqual([3, 2, 2]);
		expect(numbers.reject((value) => value > 1).all()).toEqual([1]);
		expect(numbers.first()).toBe(3);
		expect(numbers.last()).toBe(2);
		expect(
			numbers
				.chunk(2)
				.map((chunk) => chunk.all())
				.all(),
		).toEqual([
			[3, 1],
			[2, 2],
		]);
	});

	test("pluck, keyBy and groupBy work on records", () => {
		type Row = { id: number; name: string; team: string };
		const rows = collect<Row>([
			{ id: 1, name: "Ada", team: "a" },
			{ id: 2, name: "Grace", team: "a" },
			{ id: 3, name: "Linus", team: "b" },
		]);
		expect(rows.pluck("name").all()).toEqual(["Ada", "Grace", "Linus"]);
		expect(rows.keyBy("id")[2]?.name).toBe("Grace");
		expect(
			rows
				.groupBy("team")
				.a?.map((row) => row.name)
				.all(),
		).toEqual(["Ada", "Grace"]);
		expect(rows.whereIn("id", [1, 3]).all()).toHaveLength(2);
		expect(rows.where("team", "b").first()?.name).toBe("Linus");
		expect(rows.toJSON()).toHaveLength(3);
	});

	test("query results, pluck and eager to-many are collections", async () => {
		const users = await User.query().orderBy("id").get();
		expect(users).toBeInstanceOf(Collection);
		expect(users).toHaveLength(2);
		const names = await User.query().orderBy("id").pluck("name");
		expect(names).toBeInstanceOf(Collection);
		expect(names.all()).toEqual(["Ada", "Grace"]);

		const loaded = await User.query()
			.with("posts")
			.where("id", ids.ada)
			.firstOrFail();
		expect(loaded.posts).toBeInstanceOf(Collection);
		expect(loaded.posts.sum("views")).toBe(42);
		expect(loaded.posts.where("published", true).count()).toBe(1);
		expect(loaded.posts.pluck("title").all()).toEqual([
			"Analytical engine",
			"Notes",
		]);
		expect(loaded.posts.sortBy("views").pluck("views").all()).toEqual([2, 40]);

		const page = await User.query().orderBy("id").paginate(1, 1);
		expect(page.data).toBeInstanceOf(Collection);
		expect(page.data).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Relation managers
// ---------------------------------------------------------------------------

describe("relation write managers", () => {
	test("hasMany create/save/createMany scope the foreign key", async () => {
		const ada = await User.findOrFail(ids.ada);
		const created = await ada.relation("posts").create({
			title: "Manager-created",
			views: 5,
			published: true,
		});
		expect((created as Post).get("userId")).toBe(ids.ada);

		const detached = await Post.query().firstOrNew({
			title: "Saved via relation",
			views: 1,
		});
		await ada.relation("posts").save(detached);
		expect(detached.get("userId")).toBe(ids.ada);

		const many = await ada.relation("posts").createMany([
			{ title: "Batch A", views: 3 },
			{ title: "Batch B", views: 4 },
		]);
		expect(many).toBeInstanceOf(Collection);
		expect(many).toHaveLength(2);
		expect(
			await Post.query()
				.where("userId", ids.ada)
				.where("title", "like", "Batch %")
				.count(),
		).toBe(2);

		const scoped = await ada
			.relation("posts")
			.query()
			.where("published", true)
			.orderBy("id")
			.get();
		expect(scoped.pluck("title").all()).toEqual([
			"Analytical engine",
			"Manager-created",
		]);
	});

	test("belongsTo associate/dissociate updates the parent", async () => {
		const grace = await User.findOrFail(ids.grace);
		const egypt = await Country.findOrFail(ids.egypt);
		grace.relation("country").associate(egypt);
		expect(grace.get("countryId")).toBe(ids.egypt);
		await grace.save();
		const reloaded = await User.findOrFail(ids.grace);
		expect(reloaded.get("countryId")).toBe(ids.egypt);

		reloaded.relation("country").dissociate();
		expect(reloaded.get("countryId")).toBeNull();
		await reloaded.save();
		expect((await User.findOrFail(ids.grace)).get("countryId")).toBeNull();

		// restore for later tests
		reloaded.relation("country").associate(egypt);
		await reloaded.save();
	});

	test("hasManyThrough managers use the through key", async () => {
		const country = await Country.findOrFail(ids.egypt);
		const posts = await country.relation("posts").query().orderBy("id").get();
		expect(posts.pluck("title").all()).toContain("Analytical engine");
		expect(await country.relation("posts").count()).toBe(posts.count());
		expect(new Set(posts.pluck("userId").all()).has(ids.ada)).toBe(true);
	});

	test("belongsToMany attach/detach/sync/toggle/updateExistingPivot", async () => {
		const post = await Post.findOrFail(ids.adaFirst);
		const manager = post.relation("tags");
		expect(await manager.attach([ids.ts, ids.sql], { note: "initial" })).toBe(
			2,
		);
		expect(
			(await manager.query().orderBy("name").get()).pluck("name").all(),
		).toEqual(["sql", "ts"]);

		expect(await manager.updateExistingPivot(ids.ts, { note: "updated" })).toBe(
			1,
		);
		const rawRows = await orm.raw(
			'select "note" from "post_tags" where "postId" = ? and "tagId" = ?',
			[ids.adaFirst, ids.ts],
		);
		expect(rawRows.rows[0]?.note).toBe("updated");

		await manager.sync([ids.sql, ids.rust]);
		expect(
			(await manager.query().orderBy("name").get()).pluck("name").all(),
		).toEqual(["rust", "sql"]);

		await manager.toggle([ids.sql, ids.ts]);
		expect(
			(await manager.query().orderBy("name").get()).pluck("name").all(),
		).toEqual(["rust", "ts"]);

		expect(await manager.detach()).toBe(2);
		expect(await manager.query().count()).toBe(0);
	});

	test("pivot syncWithoutDetaching and syncWithPivotValues", async () => {
		const post = await Post.findOrFail(ids.adaSecond);
		const manager = post.relation("tags");
		expect(await manager.attach(ids.ts)).toBe(1);
		const synced = await manager.syncWithoutDetaching([ids.ts, ids.sql]);
		expect(synced.detached).toEqual([]);
		expect(synced.attached).toEqual([ids.sql]);
		expect((await manager.get()).pluck("name").all()).toEqual(["ts", "sql"]);

		const pivoted = await manager.syncWithPivotValues([ids.ts, ids.sql], {
			note: "bulk",
		});
		expect(pivoted.updated).toEqual([ids.ts, ids.sql]);
		const rawRows = await orm.raw(
			'select "note" from "post_tags" where "postId" = ? order by "tagId"',
			[ids.adaSecond],
		);
		expect(rawRows.rows.map((row) => row.note)).toEqual(["bulk", "bulk"]);
	});

	test("morph-free eager loading and relation find/has", async () => {
		const post = await Post.findOrFail(ids.adaFirst);
		expect(await post.relation("comments").has(999_999)).toBe(false);
		const comments = await post.relation("comments").query().get();
		expect(comments.count()).toBeGreaterThanOrEqual(2);
		const first = await post.relation("comments").first();
		expect(first?.get("postId")).toBe(ids.adaFirst);
		expect(
			await post.relation("comments").findOrFail(first?.get("id")),
		).toEqual(first!);
	});

	test("relation manager rejects pivot methods on hasMany", async () => {
		const user = await User.findOrFail(ids.ada);
		expect(() => user.relation("posts").attach(1)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Instance loading
// ---------------------------------------------------------------------------

describe("load helpers", () => {
	test("load and loadMissing attach collections", async () => {
		const user = (await User.findOrFail(ids.ada)) as User & {
			posts: Collection<Post>;
			country: Country | null;
		};
		await user.load("posts", "country");
		expect(user.posts).toBeInstanceOf(Collection);
		expect(user.country?.get("name")).toBe("Egypt");
		const missing = (await User.findOrFail(ids.grace)) as User & {
			posts: Collection<Post>;
		};
		await missing.loadMissing("posts");
		expect(missing.posts.count()).toBeGreaterThan(0);
	});

	test("loadCount and aggregate loaders add typed extras", async () => {
		const user = (await User.findOrFail(ids.ada)) as User & {
			postsCount: number;
			pending: number;
			postsSumViews: number;
			postsAvgViews: number;
			postsMinViews: number;
			postsMaxViews: number;
		};
		await user.loadCount("posts");
		expect(user.postsCount).toBeGreaterThan(0);
		await user.loadCount("posts as pending");
		expect(user.pending).toBe(user.postsCount);

		await user.loadSum("posts", "views");
		expect(user.postsSumViews).toBe(55);
		await user.loadAvg("posts", "views");
		expect(user.postsAvgViews).toBeCloseTo(55 / user.postsCount);
		await user.loadMin("posts", "views");
		expect(user.postsMinViews).toBe(1);
		await user.loadMax("posts", "views");
		expect(user.postsMaxViews).toBe(40);
		await user.loadAggregate("sum", "posts", "views");
		expect(user.postsSumViews).toBe(55);
	});
});

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

describe("scopes", () => {
	test("local scopes apply through query().scope()", async () => {
		const user = await User.query().scope("named", "Ada").firstOrFail();
		expect(user.get("name")).toBe("Ada");
		const active = await User.query().scope("activeOnly").get();
		expect(active.count()).toBeGreaterThan(0);
		expect(() =>
			(User.query() as never as { scope(name: string): unknown }).scope(
				"missing",
			),
		).toThrow();
	});

	test("global scopes apply automatically and can be removed by name", async () => {
		await User.create({
			name: "Inactive",
			email: "inactive@advanced.test",
			active: false,
		});
		const scoped = await ScopedUser.query().get();
		expect(scoped.every((user) => user.get("active") === true)).toBe(true);
		const all = await ScopedUser.withoutGlobalScopes().get();
		expect(all.some((user) => user.get("active") === false)).toBe(true);
		const withoutNamed = await ScopedUser.withoutGlobalScopes("active").get();
		expect(withoutNamed.some((user) => user.get("active") === false)).toBe(
			true,
		);
	});
});

// ---------------------------------------------------------------------------
// Query builder breadth
// ---------------------------------------------------------------------------

describe("query builder breadth", () => {
	test("whereColumn, whereAny/All/None and date parts", async () => {
		const columns = await Post.query().whereColumn("id", "=", "id").count();
		expect(columns).toBeGreaterThan(0);

		const any = await User.query()
			.whereAny(["name", "email"], "like", "%ada%")
			.get();
		expect(any.pluck("name").all()).toContain("Ada");
		const all = await User.query()
			.whereAll(["name", "email"], "like", "%advanced.test%")
			.get();
		expect(all.pluck("name").all()).toEqual([]);
		const none = await User.query()
			.whereNone(["name", "email"], "like", "%nobody%")
			.get();
		expect(none.count()).toBeGreaterThan(0);

		const today = new Date();
		const day = await Post.query()
			.whereDay("createdAt", "=", today.getUTCDate())
			.get();
		expect(day.count()).toBeGreaterThan(0);
		const month = await Post.query()
			.whereMonth("createdAt", "=", today.getUTCMonth() + 1)
			.get();
		expect(month.count()).toBeGreaterThan(0);
		const year = await Post.query()
			.whereYear("createdAt", "=", today.getUTCFullYear())
			.get();
		expect(year.count()).toBeGreaterThan(0);
		const date = await Post.query()
			.whereDate("createdAt", "=", today.toISOString().slice(0, 10))
			.get();
		expect(date.count()).toBeGreaterThan(0);
		const time = await Post.query()
			.whereTime("createdAt", "=", today.toISOString().slice(11, 19))
			.get();
		expect(time.count()).toBeGreaterThanOrEqual(0);
	});

	test("JSON predicates and withExists", async () => {
		const user = await User.create({
			name: "Json",
			email: "json@advanced.test",
			settings: ["dark", "compact"],
			secret: ["one", "two"],
		});
		expect(user.get("settings")).toBeInstanceOf(Collection);
		expect(user.get("secret")).toEqual(["one", "two"]);
		expect(user.get("nickname")).toBeNull();

		const contains = await User.query()
			.whereJsonContains("settings", "dark")
			.get();
		expect(contains.pluck("email").all()).toContain("json@advanced.test");
		const length = await User.query().whereJsonLength("settings", "=", 2).get();
		expect(length.pluck("email").all()).toContain("json@advanced.test");

		const withExists = await User.query()
			.withExists("posts")
			.where("id", ids.ada)
			.firstOrFail();
		expect(withExists.postsExists).toBe(true);
		const noPosts = await User.query()
			.withExists("posts")
			.where("email", "json@advanced.test")
			.firstOrFail();
		expect(noPosts.postsExists).toBe(false);
	});

	test("whereHasMorph filters by morph alias and type", async () => {
		const posts = await Comment.query()
			.whereHasMorph("commentable", ["posts"], (query) =>
				query.where("title", "Analytical engine"),
			)
			.orderBy("id")
			.get();
		expect(posts.pluck("body").all()).toEqual(["first", "second"]);

		const users = await Comment.query()
			.whereHasMorph("commentable", ["users"], (query) =>
				query.where("name", "Ada"),
			)
			.get();
		expect(users.pluck("body").all()).toEqual(["user comment"]);

		const allMorphs = await Comment.query()
			.whereHasMorph("commentable", "*")
			.count();
		expect(allMorphs).toBe(3);

		const constrainedAll = await Comment.query()
			.whereHasMorph("commentable", "*", (query) =>
				query.where("id", ">", 1_000_000),
			)
			.count();
		expect(constrainedAll).toBe(0);
		expect(() => Comment.query().whereHasMorph("post", ["posts"])).toThrow();
	});

	test("whereRelation, whereBelongsTo and withWhereHas", async () => {
		const byRelation = await User.query()
			.whereRelation("posts", "views", ">", 10)
			.get();
		expect(byRelation.pluck("name").all()).toEqual(["Ada", "Grace"]);
		const byBelongsTo = await User.query()
			.whereBelongsTo(await Country.findOrFail(ids.egypt))
			.get();
		expect(byBelongsTo.pluck("name").all()).toContain("Ada");

		const eagerConstrained = await User.query()
			.withWhereHas("posts", (group) => group.where("published", true))
			.where("id", ids.ada)
			.firstOrFail();
		expect(
			eagerConstrained.posts.every((post) => post.get("published") === true),
		).toBe(true);
	});

	test("raw select/order/group and firstWhere/value/sole", async () => {
		const rawRow = await Post.query()
			.selectRaw<{ upperTitle: string }>(raw('upper("title") as "upperTitle"'))
			.where("id", ids.adaFirst)
			.firstOrFail();
		expect(rawRow.upperTitle).toBe("ANALYTICAL ENGINE");

		const ordered = await Post.query()
			.orderByRaw('"views" desc')
			.limit(1)
			.get();
		expect(ordered.first()?.get("title")).toBe("Compilers");

		const latest = await Post.query()
			.latest("id")
			.lockForUpdate()
			.firstOrFail();
		expect(latest.get("id")).toBeGreaterThan(0);
		const oldest = await Post.query().oldest("id").sharedLock().firstOrFail();
		expect(oldest.get("id")).toBe(1);
		const reordered = await Post.query()
			.latest("id")
			.reorder("id", "asc")
			.firstOrFail();
		expect(reordered.get("id")).toBe(1);

		const grouped = await orm
			.table("posts")
			.select("userId")
			.selectRaw(raw('sum("views") as "total"'))
			.groupByRaw("userId")
			.orderBy("userId")
			.get();
		expect(grouped.length).toBeGreaterThan(0);
		expect(Number(grouped[0]?.total)).toBeGreaterThan(0);

		const first = await Post.query().firstWhere(
			"title",
			"=",
			"Analytical engine",
		);
		expect(first?.get("id")).toBe(ids.adaFirst);
		const value = await Post.query().where("id", ids.adaFirst).value("title");
		expect(value).toBe("Analytical engine");
		const sole = await Post.query().where("id", ids.adaFirst).sole();
		expect(sole.get("id")).toBe(ids.adaFirst);
		await expect(
			Post.query().where("userId", ids.ada).sole(),
		).rejects.toThrow();
	});

	test("firstOr / findOr / findOrNew / firstOrNew / firstOrCreate", async () => {
		const fallback = await Post.query()
			.where("id", -1)
			.firstOr(() => "fallback");
		expect(fallback).toBe("fallback");
		const found = await Post.query().findOr(ids.adaFirst, () => "nope");
		expect(found).not.toBe("nope");
		const fresh = await Post.query().findOrNew(999_999);
		expect(fresh.get("id")).toBe(999_999);
		expect(fresh.exists()).toBe(false);

		const newUser = await User.query().firstOrNew(
			{ email: "brand-new@advanced.test" },
			{ name: "Brand New" },
		);
		expect(newUser.exists()).toBe(false);
		expect(newUser.get("name")).toBe("Brand New");
		const created = await User.query().firstOrCreate(
			{ email: "brand-new-2@advanced.test" },
			{ name: "Created" },
		);
		expect(created.exists()).toBe(true);
		expect(
			(
				await User.query().firstOrCreate({ email: "brand-new-2@advanced.test" })
			).get("id"),
		).toBe(created.get("id"));
	});

	test("pagination, cursors, lazyById and chunkById", async () => {
		const simple = await Post.query().orderBy("id").simplePaginate(2, 1);
		expect(simple.data).toBeInstanceOf(Collection);
		expect(simple.data).toHaveLength(2);
		expect(simple.hasMore).toBe(true);

		const first = await Post.query().orderBy("id").cursorPaginate(2);
		expect(first.nextCursor).not.toBeNull();
		const second = await Post.query().cursorPaginate(2, {
			cursor: first.nextCursor,
		});
		expect(second.data.every((post) => post.get("id") > 2)).toBe(true);

		const lazy: number[] = [];
		for await (const post of Post.query().lazyById(2)) {
			lazy.push(post.get("id") as number);
		}
		expect(lazy.length).toBeGreaterThan(2);
		expect(new Set(lazy).size).toBe(lazy.length);

		const chunked: number[] = [];
		await Post.query().chunkById(2, (rows) => {
			chunked.push(...(rows.pluck("id").all() as number[]));
		});
		expect(new Set(chunked).size).toBe(chunked.length);
		expect(chunked.length).toBeGreaterThan(2);
	});

	test("insertOrIgnore, updateOrInsert, incrementEach and truncate", async () => {
		const result = await Post.query().insertOrIgnore({
			userId: ids.ada,
			title: "Ignored",
			views: 0,
		});
		expect(typeof result.id === "number" || result.id === undefined).toBe(true);

		const before = await User.query()
			.where("email", "json@advanced.test")
			.count();
		await User.query().updateOrInsert(
			{ email: "json@advanced.test" },
			{ name: "Json Updated" },
		);
		expect(
			await User.query().where("email", "json@advanced.test").count(),
		).toBe(before);
		expect(
			(
				await User.query().where("email", "json@advanced.test").firstOrFail()
			).get("name"),
		).toBe("Json Updated");

		await Post.query().where("id", ids.gracePost).incrementEach({ views: 5 });
		expect((await Post.findOrFail(ids.gracePost)).get("views")).toBe(75);
		await Post.query().where("id", ids.gracePost).decrementEach({ views: 3 });
		expect((await Post.findOrFail(ids.gracePost)).get("views")).toBe(72);

		await Scratch.create({ value: "one" });
		await Scratch.query().insertOrIgnore({ value: "one" });
		expect(await Scratch.query().count()).toBe(1);
		await Scratch.query().updateOrInsert({ value: "two" }, { value: "two" });
		expect(await Scratch.query().count()).toBe(2);
		await Scratch.query().truncate();
		expect(await Scratch.query().count()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Lifecycle / model helpers
// ---------------------------------------------------------------------------

describe("model lifecycle helpers", () => {
	test("changes, previous, fresh, only/except and identity", async () => {
		const user = await User.create({
			name: "Lifecycle",
			email: "lifecycle@advanced.test",
			settings: ["a"],
		});
		expect(user.wasRecentlyCreated()).toBe(true);
		expect(user.getChanges().name).toBe("Lifecycle");
		expect(user.getKey()).toBe(user.get("id"));
		expect(user.getKeyName()).toBe("id");
		expect(user.only("name", "email")).toEqual({
			name: "Lifecycle",
			email: "lifecycle@advanced.test",
		});
		expect(user.except("id", "createdAt", "updatedAt").name).toBe("Lifecycle");

		const fresh = await user.fresh();
		expect(fresh?.is(user)).toBe(true);
		expect(fresh?.isNot(user)).toBe(false);

		await user.update({ name: "Lifecycle 2" });
		expect(user.getChanges().name).toBe("Lifecycle 2");
		expect(user.getPrevious().name).toBe("Lifecycle");
		expect(user.isDirty()).toBe(false);
		await user.set("name", "Lifecycle 3");
		expect(user.isDirty("name")).toBe(true);
		expect(user.isClean("email")).toBe(true);
		expect(user.getOriginal("name")).toBe("Lifecycle 2");
	});

	test("touch, quiet saves and push save loaded relations", async () => {
		const post = await Post.findOrFail(ids.adaFirst);
		const oldTouch = post.get("updatedAt");
		await Bun.sleep(5);
		expect(await post.touch()).toBe(true);
		expect((post.get("updatedAt") as Date).getTime()).toBeGreaterThanOrEqual(
			(oldTouch as Date).getTime(),
		);

		const user = await User.findOrFail(ids.ada);
		let savedEvents = 0;
		const off = User.on("saved", () => {
			savedEvents += 1;
		});
		user.set("name", "Quiet Ada");
		await user.saveQuietly();
		expect(savedEvents).toBe(0);
		off();

		const loadedUser = user as User & { posts: Collection<Post> };
		await loadedUser.load("posts");
		const first = loadedUser.posts.first()!;
		first.set("title", "Pushed title");
		user.set("name", "Ada Pushed");
		await user.push();
		expect((await Post.findOrFail(first.get("id"))).get("title")).toBe(
			"Pushed title",
		);
	});

	test("touches update the belongsTo owner's timestamp", async () => {
		const user = await User.findOrFail(ids.grace);
		const before = (user.get("updatedAt") as Date).getTime();
		await Bun.sleep(5);
		const post = await Post.findOrFail(ids.gracePost);
		post.set("title", "Touched owner");
		await post.save();
		const after = (await User.findOrFail(ids.grace)).get("updatedAt") as Date;
		expect(after.getTime()).toBeGreaterThan(before);
	});
});

// ---------------------------------------------------------------------------
// Casts
// ---------------------------------------------------------------------------

describe("advanced casts", () => {
	test("collection, stringable, enum and class casts", async () => {
		const user = await User.create({
			name: "Casts",
			email: "casts@advanced.test",
			code: "MiXeD",
			status: "active",
			settings: collect(["x", "y"]),
			nickname: "nick",
		});
		expect(user.get("settings")).toBeInstanceOf(Collection);
		expect((user.get("settings") as Collection<string>).all()).toEqual([
			"x",
			"y",
		]);
		expect(String(user.get("nickname"))).toBe("nick");
		expect(
			String(
				(user.get("nickname") as unknown as { upper(): { value(): string } })
					.upper()
					.value(),
			),
		).toBe("NICK");
		expect(user.get("code")).toBe("MIXED");

		const reloaded = await User.findOrFail(user.get("id"));
		expect(reloaded.get("settings")).toBeInstanceOf(Collection);
		expect(reloaded.get("code")).toBe("MIXED");

		expect(() => {
			user.set("status", "unknown" as never);
		}).toThrow(CastError);
	});

	test("encrypted:array round-trips through the database", async () => {
		const user = await User.create({
			name: "Encrypted",
			email: "encrypted@advanced.test",
			secret: ["token", "refresh"],
			prefs: collect(["compact", "dark"]),
		});
		const reloaded = await User.findOrFail(user.get("id"));
		expect(reloaded.get("secret")).toEqual(["token", "refresh"]);
		expect(reloaded.get("prefs")).toBeInstanceOf(Collection);
		expect((reloaded.get("prefs") as Collection<string>).all()).toEqual([
			"compact",
			"dark",
		]);
		const raw = await orm.raw('select "secret" from "users" where "id" = ?', [
			user.get("id"),
		]);
		expect(String(raw.rows[0]?.secret).startsWith("v1:")).toBe(true);
	});
});
