// Priority-1 Eloquent parity features — SQLite runtime tests.
//
// Covers the query-builder, model and aggregate egresses added on top of the
// original surface: whereExists/selectSub/union, integer raw lists,
// inRandomOrder, doesntExist/soleValue, aggregate constraints, withAggregate,
// createOrFirst.

import { beforeAll, describe, expect, test } from "bun:test";
import {
	belongsTo,
	belongsToMany,
	defineSchema,
	hasMany,
	hasOne,
	InvalidModelUsageError,
	InvalidQueryError,
	latestOfMany,
	ModelNotFoundError,
	morphedByMany,
	morphTo,
	morphToMany,
	Orm,
	ofMany,
	oldestOfMany,
	withDefault,
	withDefaultFor,
} from "../../src/index";
import { sqlite } from "../../src/sqlite";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		age: { type: "integer", nullable: true },
		active: { type: "boolean", default: true },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
		deletedAt: { type: "datetime", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		published: { type: "boolean", default: false },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
		deletedAt: { type: "datetime", nullable: true },
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		postId: "integer",
		body: "string",
		approved: { type: "boolean", default: false },
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
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	tags: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	taggables: {
		tagId: "integer",
		taggableId: "integer",
		taggableType: "string",
	},
});

const orm = new Orm({ schema, dialect: sqlite(":memory:") });

class User extends orm.model("users") {
	static relations = {
		posts: hasMany(() => Post, "userId"),
		publishedPosts: hasMany(() => Post, "userId"),
		recentPost: hasOne(() => Post, "userId"),
		mostViewedPost: latestOfMany(() => Post, "userId", "views"),
		leastViewedPost: oldestOfMany(() => Post, "userId", "views"),
		topByViews: ofMany(() => Post, "userId", "views", "max"),
		roles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
			withPivot: ["note"],
			timestamps: true,
			as: "membership",
		}),
		plainRoles: belongsToMany(() => Role, {
			through: "role_user",
			foreignPivotKey: "userId",
			relatedPivotKey: "roleId",
		}),
	};
	static fillable = ["name", "email", "age", "active"] as const;
	static accessors = {
		greeting: (user: { get(name: string): unknown }) =>
			`Hi ${String(user.get("name"))}`,
	} as const;
	static softDeletes = true;
}

class Post extends orm.model("posts") {
	static relations = {
		author: belongsTo(() => User, "userId"),
		authorOrDefault: withDefault(
			belongsTo(() => User, "userId"),
			{
				name: "Guest",
			},
		),
		authorFor: withDefaultFor(
			belongsTo(() => User, "userId"),
			(_post, user) => {
				(user as { fill(values: Record<string, unknown>): unknown }).fill({
					name: "Placeholder",
				});
			},
			{ active: false },
		),
		team: belongsTo(() => User, "userId"),
		comments: hasMany(() => Comment, "postId"),
		tags: morphToMany(() => Tag, "taggable", {
			through: "taggables",
			foreignPivotKey: "taggableId",
			relatedPivotKey: "tagId",
		}),
	};
	static fillable = ["userId", "title", "views", "published"] as const;
}

class Comment extends orm.model("comments") {
	static relations = {
		post: belongsTo(() => Post, "postId"),
		commentable: morphTo("commentable", () => ({ posts: Post })),
	};
}

class Role extends orm.model("roles") {
	static fillable = ["name"] as const;
}

class Tag extends orm.model("tags") {
	static relations = {
		posts: morphedByMany(() => Post, "taggable", {
			through: "taggables",
			foreignPivotKey: "tagId",
			relatedPivotKey: "taggableId",
		}),
	};
	static fillable = ["name"] as const;
}

// The global morph map registers `Post` under an alias that does not match its
// table, proving every polymorphic write/read goes through `orm.morphAlias()`.
orm.morphMap({ articles: Post });

async function seed(): Promise<void> {
	const builder = orm.schemaBuilder();
	await builder.create("users", (t) => {
		t.id();
		t.string("name", 120);
		t.string("email", 190).unique();
		t.integer("age").nullable();
		t.boolean("active").default(true);
		t.timestamps();
		t.datetime("deletedAt").nullable();
	});
	await builder.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title", 200);
		t.integer("views").default(0);
		t.boolean("published").default(false);
		t.timestamps();
		t.datetime("deletedAt").nullable();
	});
	await builder.create("comments", (t) => {
		t.id();
		t.integer("postId");
		t.text("body");
		t.boolean("approved").default(false);
		t.integer("commentableId").nullable();
		t.string("commentableType", 60).nullable();
	});
	await builder.create("roles", (t) => {
		t.id();
		t.string("name", 60);
	});
	await builder.create("role_user", (t) => {
		t.integer("userId");
		t.integer("roleId");
		t.string("note", 200).nullable();
		t.datetime("createdAt").nullable();
		t.datetime("updatedAt").nullable();
	});
	await builder.create("tags", (t) => {
		t.id();
		t.string("name", 60);
	});
	await builder.create("taggables", (t) => {
		t.integer("tagId");
		t.integer("taggableId");
		t.string("taggableType", 60);
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
		userId: adaId,
		title: "Late",
		views: 50,
		published: true,
	});
	const compilers = await Post.create({
		userId: graceId,
		title: "Compilers",
		views: 99,
		published: true,
	});
	const compilersId = compilers.get("id") as number;
	await Comment.create({ postId: compilersId, body: "Nice", approved: true });
	await Comment.create({ postId: compilersId, body: "Meh", approved: false });

	const admin = await Role.create({ name: "admin" });
	await Role.create({ name: "editor" });
	await orm
		.table("role_user")
		.insert({ userId: adaId, roleId: admin.get("id") as number });
});

describe("query builder parity", () => {
	test("whereNotBetween / orWhereNotBetween", async () => {
		const outside = await orm
			.table("users")
			.whereNotBetween("age", [40, 50])
			.get();
		expect(outside.map((row) => row.name).all()).toEqual(["Ada"]);
		const either = await orm
			.table("users")
			.where("name", "Grace")
			.orWhereNotBetween("age", [40, 50])
			.get();
		expect(
			either
				.map((row) => row.name)
				.sort()
				.all(),
		).toEqual(["Ada", "Grace"]);
		expect(() =>
			orm.table("users").whereNotBetween("age", [1] as never),
		).toThrow(InvalidQueryError);
	});

	test("orWhereNot negates a group and links with or", async () => {
		const rows = await orm
			.table("users")
			.where("name", "Grace")
			.orWhereNot((group) => group.where("age", ">", 100))
			.get();
		expect(rows).toHaveLength(2);
	});

	test("whereIntegerInRaw / whereIntegerNotInRaw inline validated integers", async () => {
		const inList = await orm
			.table("users")
			.whereIntegerInRaw("id", [adaId, graceId, 999])
			.orderBy("id")
			.get();
		expect(inList).toHaveLength(2);
		const notIn = await orm
			.table("users")
			.whereIntegerNotInRaw("id", [adaId])
			.get();
		expect(notIn.map((row) => row.name).all()).toEqual(["Grace"]);
		const emptyIn = await orm.table("users").whereIntegerInRaw("id", []).get();
		expect(emptyIn).toHaveLength(0);
		const emptyNotIn = await orm
			.table("users")
			.whereIntegerNotInRaw("id", [])
			.get();
		expect(emptyNotIn).toHaveLength(2);
		expect(() =>
			orm.table("users").whereIntegerInRaw("id", ["1" as never]),
		).toThrow(InvalidQueryError);
		// bigint values are rendered exactly
		const big = await orm
			.table("users")
			.whereIntegerInRaw("id", [BigInt(adaId)])
			.get();
		expect(big).toHaveLength(1);
	});

	test("whereExists / whereNotExists correlate with the outer query", async () => {
		const authors = await orm
			.table("users")
			.whereExists("posts", (posts) =>
				posts
					.whereColumn("posts.userId", "=", "users.id")
					.where("posts.published", true),
			)
			.orderBy("users.id")
			.get();
		expect(authors.map((row) => row.name).all()).toEqual(["Ada", "Grace"]);

		const draftOnly = await orm
			.table("users")
			.whereExists("posts", (posts) =>
				posts
					.whereColumn("posts.userId", "=", "users.id")
					.where("posts.views", 3),
			)
			.get();
		expect(draftOnly.map((row) => row.name).all()).toEqual(["Ada"]);

		const noPosts = await orm
			.table("users")
			.whereNotExists("posts", (posts) =>
				posts.whereColumn("posts.userId", "=", "users.id"),
			)
			.get();
		expect(noPosts).toHaveLength(0);
	});

	test("selectSub adds a correlated scalar column", async () => {
		const rows = await orm
			.table("users")
			.selectSub("posts", "latestTitle", (posts) =>
				posts
					.select("title")
					.whereColumn("posts.userId", "=", "users.id")
					.orderBy("posts.id", "desc")
					.limit(1),
			)
			.orderBy("users.id")
			.get();
		expect(rows[0]?.latestTitle).toBe("Late");
		expect(rows[1]?.latestTitle).toBe("Compilers");
	});

	test("union / unionAll combine result sets", async () => {
		const highViews = orm.table("posts").select("id").where("views", ">", 90);
		const drafts = orm.table("posts").select("id").where("title", "Draft");
		const union = await highViews.clone().union(drafts).orderBy("id").get();
		expect(union).toHaveLength(2);
		const unionAll = await highViews
			.clone()
			.unionAll(drafts.clone().unionAll(drafts))
			.orderBy("id")
			.get();
		expect(unionAll).toHaveLength(3);
	});

	test("inRandomOrder returns the whole set", async () => {
		const rows = await orm.table("users").inRandomOrder().get();
		expect(
			rows
				.map((row) => row.name)
				.sort()
				.all(),
		).toEqual(["Ada", "Grace"]);
	});

	test("doesntExist and soleValue", async () => {
		expect(await orm.table("users").where("name", "Ada").doesntExist()).toBe(
			false,
		);
		expect(await orm.table("users").where("name", "Nobody").doesntExist()).toBe(
			true,
		);
		expect(
			await orm
				.table("users")
				.where("email", "ada@example.com")
				.soleValue("id"),
		).toBe(adaId);
		await expect(
			orm.table("users").where("name", "Nobody").soleValue("id"),
		).rejects.toThrow(ModelNotFoundError);
		await expect(orm.table("users").soleValue("id")).rejects.toThrow(
			InvalidQueryError,
		);
	});

	test("unless applies the callback only when the condition is falsy", async () => {
		const rows = await orm
			.table("users")
			.unless(true, (q) => q.where("name", "Nobody"))
			.unless(false, (q) => q.where("active", false))
			.get();
		expect(rows.map((row) => row.name).all()).toEqual(["Grace"]);
	});

	test("aggregate constraints + withAggregate", async () => {
		const rows = await User.query()
			.withCount({ posts: (q) => q.where("published", true) })
			.withExists({ posts: (q) => q.where("views", 3) })
			.withSum("posts", "views", (q) => q.where("published", true))
			.withAggregate("posts", { function: "max", column: "views" })
			.orderBy("id")
			.get();
		type ExtraReadable = {
			postsCount: number;
			postsExists: boolean;
			postsSumViews: number;
			postsMaxViews: number;
		};
		const ada = rows[0] as unknown as ExtraReadable;
		const grace = rows[1] as unknown as ExtraReadable;
		expect(ada.postsCount).toBe(2);
		expect(ada.postsExists).toBe(true);
		expect(ada.postsSumViews).toBe(60);
		expect(ada.postsMaxViews).toBe(50);
		expect(grace.postsCount).toBe(1);
		expect(grace.postsExists).toBe(false);
		expect(grace.postsMaxViews).toBe(99);

		const [counted] = await User.query()
			.where("id", adaId)
			.withAggregate("posts", { function: "count" })
			.get();
		expect((counted as unknown as { postsCount: number }).postsCount).toBe(3);
		expect(() =>
			User.query().withSum("posts", "views", (q) =>
				q.join("users", "posts.userId", "=", "users.id"),
			),
		).toThrow(InvalidQueryError);
	});

	test("createOrFirst inserts once and returns the winner on conflict", async () => {
		const first = await User.query().createOrFirst(
			{ email: "race@example.com" },
			{ name: "Race" },
		);
		expect(first.get("name")).toBe("Race");
		const second = await User.query().createOrFirst(
			{ email: "race@example.com" },
			{ name: "Other" },
		);
		expect(second.get("name")).toBe("Race");
		expect(second.get("id")).toBe(first.get("id"));
		const count = await User.query().where("email", "race@example.com").count();
		expect(count).toBe(1);
	});
});

describe("model parity", () => {
	test("destroy deletes by id — variadic, arrayed and missing ids", async () => {
		const a = await Post.create({ userId: adaId, title: "Gone A", views: 0 });
		const b = await Post.create({ userId: adaId, title: "Gone B", views: 0 });
		const c = await Post.create({ userId: adaId, title: "Gone C", views: 0 });
		const aId = a.get("id") as number;
		const bId = b.get("id") as number;
		const cId = c.get("id") as number;
		expect(await Post.destroy(aId)).toBe(1);
		expect(await Post.destroy([bId, cId], 999_999)).toBe(2);
		expect(
			await Post.query().whereIntegerInRaw("id", [aId, bId, cId]).count(),
		).toBe(0);
		expect(await Post.destroy([])).toBe(0);
	});

	test("destroy on a soft-deleting model trashes instead of deleting", async () => {
		const ghost = await User.create({
			name: "Ghost",
			email: "ghost@example.com",
		});
		const ghostId = ghost.get("id") as number;
		expect(await User.destroy(ghostId)).toBe(1);
		expect(await User.query().where("id", ghostId).count()).toBe(0);
		expect(await User.withTrashed().where("id", ghostId).count()).toBe(1);
		// already trashed — nothing left to destroy
		expect(await User.destroy(ghostId)).toBe(0);
	});

	test("instance increment/decrement mirror the database", async () => {
		const post = await Post.create({
			userId: graceId,
			title: "Counter",
			views: 10,
		});
		const id = post.get("id") as number;
		expect(await post.increment("views", 5)).toBe(1);
		expect(post.get("views")).toBe(15);
		expect((await Post.findOrFail(id)).get("views")).toBe(15);
		expect(await post.decrement("views", 4)).toBe(1);
		expect(post.get("views")).toBe(11);
		// extra columns are written in the same UPDATE and mirrored locally
		expect(await post.increment("views", 1, { title: "Bumped" })).toBe(1);
		expect(post.get("views")).toBe(12);
		expect(post.get("title")).toBe("Bumped");
		const reread = await Post.findOrFail(id);
		expect(reread.get("views")).toBe(12);
		expect(reread.get("title")).toBe("Bumped");
	});

	test("increment fires updating/updated, honours cancellation and quiet mode", async () => {
		const post = await Post.create({
			userId: graceId,
			title: "Events",
			views: 1,
		});
		const seen: string[] = [];
		const stopUpdating = Post.on("updating", (model) => {
			seen.push(`updating:${String(model.get("views"))}`);
		});
		const stopUpdated = Post.on("updated", (model) => {
			seen.push(`updated:${String(model.get("views"))}`);
		});
		await post.increment("views");
		stopUpdating();
		stopUpdated();
		expect(seen).toEqual(["updating:1", "updated:2"]);

		const stopCancel = Post.on("updating", () => false);
		expect(await post.increment("views")).toBe(0);
		expect(post.get("views")).toBe(2);
		stopCancel();

		const quietSeen: string[] = [];
		const stopQuiet = Post.on("updating", () => {
			quietSeen.push("x");
		});
		expect(await post.incrementQuietly("views")).toBe(1);
		stopQuiet();
		expect(quietSeen).toEqual([]);
		expect(post.get("views")).toBe(3);
	});

	test("instance increment on an unsaved model throws", async () => {
		const ghost = await Post.query().firstOrNew({ title: "Nowhere" });
		await expect(ghost.increment("views")).rejects.toThrow(
			InvalidModelUsageError,
		);
	});

	test("toArray matches toJSON and append adds accessors per instance", async () => {
		const user = await User.findOrFail(adaId);
		expect(user.toArray()).toEqual(user.toJSON());
		expect(
			(user.toArray() as Record<string, unknown>).greeting,
		).toBeUndefined();
		user.append("greeting");
		expect((user.toArray() as Record<string, unknown>).greeting).toBe("Hi Ada");
		expect(() => user.append("nope")).toThrow(InvalidModelUsageError);
	});

	test("the static createOrFirst is the model-level entry point", async () => {
		const first = await User.createOrFirst(
			{ email: "static@example.com" },
			{ name: "Static" },
		);
		expect(first.get("name")).toBe("Static");
		const second = await User.createOrFirst(
			{ email: "static@example.com" },
			{ name: "Second" },
		);
		expect(second.get("id")).toBe(first.get("id"));
		expect(
			await User.query().where("email", "static@example.com").count(),
		).toBe(1);
	});
});

describe("ofMany and withDefault parity", () => {
	test("latestOfMany / oldestOfMany / ofMany eager-load the extreme row", async () => {
		const users = await User.query()
			.with("mostViewedPost", "leastViewedPost", "topByViews")
			.orderBy("id")
			.get();
		const ada = users[0]!;
		const grace = users[1]!;
		expect(ada.mostViewedPost?.get("title")).toBe("Late");
		expect(ada.leastViewedPost?.get("title")).toBe("Draft");
		expect(ada.topByViews?.get("title")).toBe("Late");
		// Grace's posts (created in the model-parity suite): Compilers (99),
		// Counter (12), Events (3).
		expect(grace.mostViewedPost?.get("title")).toBe("Compilers");
		expect(grace.leastViewedPost?.get("title")).toBe("Events");
	});

	test("ofMany ties break deterministically on the primary key", async () => {
		const tia = await User.create({ name: "Tia", email: "tia@example.com" });
		const tiaId = tia.get("id") as number;
		const first = await Post.create({
			userId: tiaId,
			title: "Tie A",
			views: 500,
		});
		const second = await Post.create({
			userId: tiaId,
			title: "Tie B",
			views: 500,
		});
		expect(second.get("id")).toBeGreaterThan(first.get("id") as number);
		const [loaded] = await User.query()
			.where("id", tiaId)
			.with("topByViews", "leastViewedPost")
			.get();
		// Ties resolve on the primary key in the aggregate's direction.
		expect(loaded?.topByViews?.get("title")).toBe("Tie B");
		expect(loaded?.leastViewedPost?.get("title")).toBe("Tie A");
		// Keep the subsequent expectations focused on Ada and Grace.
		await User.destroy(tiaId);
	});

	test("constraint callbacks filter the selected extreme row", async () => {
		const [ada] = await User.query()
			.where("id", adaId)
			.with({ topByViews: (q) => q.where("views", ">", 100) })
			.get();
		// Ada's extreme ("Late", 50 views) fails the constraint → null.
		expect(ada?.topByViews).toBeNull();
		const [grace] = await User.query()
			.where("id", graceId)
			.with({ topByViews: (q) => q.where("published", true) })
			.get();
		expect(grace?.topByViews?.get("title")).toBe("Compilers");
	});

	test("whereHas / withCount / withSum respect the extreme selection", async () => {
		const withViews = await User.query()
			.whereHas("topByViews", (q) => q.where("views", ">", 40))
			.orderBy("id")
			.get();
		expect(withViews.map((user) => user.get("name")).all()).toEqual([
			"Ada",
			"Grace",
		]);
		const none = await User.query()
			.whereHas("topByViews", (q) => q.where("views", ">", 5000))
			.get();
		expect(none).toHaveLength(0);

		const [counted] = await User.query()
			.where("id", adaId)
			.withCount("topByViews")
			.withSum("topByViews", "views")
			.get();
		expect(
			(counted as unknown as { topByViewsCount: number }).topByViewsCount,
		).toBe(1);
		expect(
			(counted as unknown as { topByViewsSumViews: number }).topByViewsSumViews,
		).toBe(50);
	});

	test("manager query() scopes to the extreme row", async () => {
		const ada = await User.findOrFail(adaId);
		const rows = await ada.relation("topByViews").query().get();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.get("title")).toBe("Late");
	});

	test("withDefault returns a placeholder owner for a dangling foreign key", async () => {
		const orphan = await Post.create({
			userId: 999_999,
			title: "Orphan",
			views: 0,
		});
		const orphanId = orphan.get("id") as number;
		const [plain] = await Post.query()
			.where("id", orphanId)
			.with("author")
			.get();
		expect(plain?.author).toBeNull();

		const [defaulted] = await Post.query()
			.where("id", orphanId)
			.with("authorOrDefault", "authorFor")
			.get();
		expect(defaulted?.authorOrDefault?.get("name")).toBe("Guest");
		expect(defaulted?.authorFor?.get("name")).toBe("Placeholder");
		expect(defaulted?.authorFor?.get("active")).toBe(false);

		// A real owner is never replaced by the placeholder.
		const [real] = await Post.query()
			.where("title", "Late")
			.with("authorOrDefault")
			.get();
		expect(real?.authorOrDefault?.get("name")).toBe("Ada");
	});
});

describe("pivot parity", () => {
	test("withPivot / timestamps / as hydrate a per-parent pivot object", async () => {
		const editor = await Role.query().where("name", "editor").firstOrFail();
		const editorId = editor.get("id") as number;
		const ada = await User.findOrFail(adaId);
		await ada.relation("roles").attach(editorId, { note: "second role" });

		const [loaded] = await User.query()
			.where("id", adaId)
			.with("roles", "plainRoles")
			.get();
		const roles = loaded?.roles ?? [];
		expect(roles).toHaveLength(2);
		const editorRole = roles.find((role) => role.get("name") === "editor");
		const membership = editorRole?.membership;
		expect(membership?.userId).toBe(adaId);
		expect(membership?.roleId).toBe(editorId);
		expect(membership?.note).toBe("second role");
		expect(membership?.createdAt).toBeDefined();
		expect(membership?.updatedAt).toBeDefined();

		// The default accessor only carries the pivot keys.
		const plainRole = loaded?.plainRoles?.first();
		expect(
			plainRole === undefined ? [] : Object.keys(plainRole.pivot).sort(),
		).toEqual(["roleId", "userId"]);
	});

	test("each parent receives its own related instance (pivot clone-per-parent)", async () => {
		const [role] = await Role.query().where("name", "admin").get();
		const roleId = role?.get("id") as number;
		const grace = await User.findOrFail(graceId);
		await grace.relation("roles").attach(roleId, { note: "grace note" });

		const users = await User.query()
			.whereIn("id", [adaId, graceId])
			.with("roles")
			.orderBy("id")
			.get();
		const adaRole = users[0]?.roles.find(
			(item) => item.get("name") === "admin",
		);
		const graceRole = users[1]?.roles.find(
			(item) => item.get("name") === "admin",
		);
		expect(adaRole).not.toBe(graceRole);
		expect(adaRole?.membership.note).toBeNull();
		expect(graceRole?.membership.note).toBe("grace note");
		// Mutating one parent's instance never leaks into the other.
		adaRole?.set("name", "mutated");
		expect(graceRole?.get("name")).toBe("admin");

		await grace.relation("roles").detach(roleId);
	});

	test("wherePivot / wherePivotIn filter and orderByPivot orders through the pivot", async () => {
		const ada = await User.findOrFail(adaId);
		const admin = await Role.query().where("name", "admin").firstOrFail();
		const adminId = admin.get("id") as number;
		await ada.relation("roles").attach(adminId, { note: "primary" });
		const withNote = await ada
			.relation("roles")
			.wherePivot("note", "primary")
			.query()
			.orderBy("name")
			.get();
		expect(withNote.pluck("name").all()).toEqual(["admin"]);

		const notPrimary = await ada
			.relation("roles")
			.wherePivot("note", "!=", "primary")
			.query()
			.orderBy("name")
			.get();
		expect(notPrimary.pluck("name").all()).toEqual(["editor"]);

		const inList = await ada
			.relation("roles")
			.wherePivotIn("note", ["primary", "second role"])
			.query()
			.orderBy("name")
			.get();
		expect(inList.pluck("name").all()).toEqual(["admin", "editor"]);

		const unordered = await ada.relation("roles").query().orderBy("name").get();
		expect(unordered.pluck("name").all()).toEqual(["admin", "editor"]);

		// orderByPivot reads the matching pivot row (ascending: null sorts first).
		const ordered = await ada
			.relation("roles")
			.orderByPivot("note", "desc")
			.query()
			.get();
		expect(ordered.pluck("name").all()).toEqual(["editor", "admin"]);
	});

	test("wherePivot validates operators and rejects non-pivot relations", async () => {
		const ada = await User.findOrFail(adaId);
		expect(() => ada.relation("roles").wherePivot("note", "drop", 1)).toThrow(
			InvalidQueryError,
		);
		expect(() => ada.relation("posts").wherePivot("note", "x")).toThrow(
			InvalidQueryError,
		);
		expect(() => ada.relation("posts").orderByPivot("note")).toThrow(
			InvalidQueryError,
		);
		// An empty `wherePivotIn` matches nothing instead of throwing.
		const empty = await ada
			.relation("roles")
			.wherePivotIn("note", [])
			.query()
			.get();
		expect(empty).toHaveLength(0);
	});

	test("timestamps are written on attach and refreshed on update", async () => {
		const post = await Post.create({
			userId: adaId,
			title: "Pivot stamps",
			views: 0,
		});
		expect(post.get("id")).toBeGreaterThan(0);
		// Pivot timestamps belong to pivot relations; use a fresh user row so
		// the role pivot table stays predictable.
		const user = await User.create({
			name: "Stamps",
			email: "stamps@example.com",
		});
		const userId = user.get("id") as number;
		const role = await Role.create({ name: "stamps-role" });
		const roleId = role.get("id") as number;
		await user.relation("roles").attach(roleId);
		const [firstRow] = (
			await orm.raw(
				'select "createdAt", "updatedAt" from "role_user" where "userId" = ? and "roleId" = ?',
				[userId, roleId],
			)
		).rows as Array<{ createdAt: string; updatedAt: string }>;
		expect(typeof firstRow?.createdAt).toBe("string");
		expect(firstRow?.createdAt).toBe(firstRow?.updatedAt);

		await Bun.sleep(5);
		await user
			.relation("roles")
			.updateExistingPivot(roleId, { note: "touched" });
		const [secondRow] = (
			await orm.raw(
				'select "createdAt", "updatedAt" from "role_user" where "userId" = ? and "roleId" = ?',
				[userId, roleId],
			)
		).rows as Array<{ createdAt: string; updatedAt: string }>;
		expect(secondRow?.createdAt).toBe(firstRow?.createdAt);
		expect(
			new Date(String(secondRow?.updatedAt)).getTime(),
		).toBeGreaterThanOrEqual(new Date(String(firstRow?.updatedAt)).getTime());
	});
});

describe("morphedByMany and the global morph map", () => {
	test("morphToMany and morphedByMany share one polymorphic pivot", async () => {
		const post = await Post.create({
			userId: adaId,
			title: "Polymorphic",
			views: 0,
		});
		const postId = post.get("id") as number;
		const tag = await Tag.create({ name: "orm" });
		const tagId = tag.get("id") as number;

		// Writes go through the global map: Post is aliased as "articles".
		expect(await post.relation("tags").attach(tagId)).toBe(1);
		const [rawRow] = (
			await orm.raw(
				'select "taggableType", "taggableId" from "taggables" where "tagId" = ?',
				[tagId],
			)
		).rows as Array<{ taggableType: string; taggableId: number }>;
		expect(rawRow?.taggableType).toBe("articles");
		expect(rawRow?.taggableId).toBe(postId);

		// Forward eager load (`morphToMany`) — the alias comes from the owner.
		const [loadedPost] = await Post.query()
			.where("id", postId)
			.with("tags")
			.get();
		expect(loadedPost?.tags.pluck("name").all()).toEqual(["orm"]);
		expect(loadedPost?.tags.first()?.pivot.taggableType).toBe("articles");

		// Inverse eager load (`morphedByMany`) — the alias comes from the
		// *related* class, so the same pivot rows are visible from Tag.
		const [loadedTag] = await Tag.query()
			.where("id", tagId)
			.with("posts")
			.get();
		expect(loadedTag?.posts.pluck("title").all()).toEqual(["Polymorphic"]);
		expect(loadedTag?.posts.first()?.pivot.tagId).toBe(tagId);

		// Existence subqueries work in both directions.
		expect(await post.relation("tags").count()).toBe(1);
		expect(
			await Tag.query()
				.whereHas("posts", (query) => query.where("title", "Polymorphic"))
				.count(),
		).toBe(1);
		expect(
			await Tag.query()
				.whereHas("posts", (query) => query.where("title", "Nope"))
				.count(),
		).toBe(0);

		// Manager queries from the inverse side see the same rows.
		const tagPosts = await tag.relation("posts").query().get();
		expect(tagPosts.pluck("title").all()).toEqual(["Polymorphic"]);
	});

	test("morphTo resolves aliases through the global map", async () => {
		expect(orm.morphAlias(Post)).toBe("articles");
		expect(orm.morphAlias(Comment)).toBe("comments");
		expect(orm.morphClass("articles")).toBe(Post);
		expect(orm.morphClass("missing")).toBeUndefined();
		expect(orm.morphMapEntries().map(([alias]) => alias)).toEqual(["articles"]);

		const post = await Post.query().where("title", "Polymorphic").firstOrFail();
		const postId = post.get("id") as number;
		const comment = await Comment.create({
			postId,
			body: "Map me",
		});
		const commentId = comment.get("id") as number;
		comment.relation("commentable").associate(post);
		await comment.save();

		const [reloaded] = await orm.table("comments").where("id", commentId).get();
		expect(reloaded?.commentableType).toBe("articles");
		expect(reloaded?.commentableId).toBe(postId);

		// The relation's types map only knows "posts"; the stored "articles"
		// alias is resolved through the global map.
		const [withOwner] = await Comment.query()
			.where("id", commentId)
			.with("commentable")
			.get();
		expect(withOwner?.commentable?.get("title")).toBe("Polymorphic");

		// `whereHas` enumerates global aliases too, so the same row matches.
		expect(await Comment.query().whereHas("commentable").count()).toBe(1);
		const viaManager = await comment.relation("commentable").query().first();
		expect(viaManager?.get("title")).toBe("Polymorphic");
	});
});
