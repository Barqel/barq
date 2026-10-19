// Eloquent-parity integration suite (SQLite, in-memory, real driver).
//
// Covers the six feature batches end-to-end:
//   1. increment/decrement, firstOrCreate/updateOrCreate, getOriginal, replicate
//   2. withSum/withAvg/withMin/withMax, whereDoesntHave/orWhereHas/nested
//      whereHas, constrained eager loading
//   3. model events and observers
//   4. soft deletes
//   5. polymorphic and through relations
//   6. accessors, mutators, casts, appends, visibility

import { beforeAll, describe, expect, test } from "bun:test";
import {
	belongsTo,
	CastError,
	defineSchema,
	hasMany,
	hasManyThrough,
	hasOne,
	hasOneThrough,
	InvalidModelUsageError,
	InvalidQueryError,
	morphMany,
	morphOne,
	morphTo,
	morphToMany,
	Orm,
	SchemaError,
	verifyHashedValue,
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
		password: { type: "text", nullable: true },
		secret: { type: "text", nullable: true },
		nickname: { type: "string", nullable: true },
		permissions: { type: "json", nullable: true },
		settings: { type: "json", nullable: true },
		countryId: { type: "integer", nullable: true },
		deletedAt: { type: "datetime", nullable: true },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		published: { type: "boolean", default: false },
		deletedAt: { type: "datetime", nullable: true },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	profiles: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		bio: { type: "text", nullable: true },
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		body: "string",
		commentableId: "integer",
		commentableType: "string",
	},
	videos: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		title: "string",
	},
	tags: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	taggables: {
		taggableId: "integer",
		taggableType: "string",
		tagId: "integer",
	},
});

const orm = new Orm({
	schema,
	dialect: sqlite(":memory:"),
	encryptionKey: "eloquent-suite-key",
});

class Country extends orm.model("countries") {
	static relations = {
		users: hasMany(() => User, "countryId"),
		posts: hasManyThrough(
			() => Post,
			() => User,
			"countryId",
			"userId",
		),
		latestPost: hasOneThrough(
			() => Post,
			() => User,
			"countryId",
			"userId",
		),
	};
}

class User extends orm.model("users") {
	static softDeletes = true;
	static fillable = [
		"name",
		"email",
		"password",
		"secret",
		"nickname",
		"permissions",
		"settings",
		"countryId",
	] as const;
	static casts = {
		settings: "json",
		permissions: "array",
		secret: "encrypted",
		password: "hashed",
		nickname: {
			get: (value: unknown) => (value === null ? null : `@${String(value)}`),
			set: (value: unknown) => String(value).replace(/^@/, ""),
		},
	} as const;
	static mutators = {
		email: (value: unknown) => String(value).trim().toLowerCase(),
	};
	static accessors = {
		displayName: (user: User) => `${user.get("name")} <${user.get("email")}>`,
	};
	static appends = ["displayName"] as const;
	static hidden = ["password", "secret"] as const;
	static relations = {
		posts: hasMany(() => Post, "userId"),
		profile: hasOne(() => Profile, "userId"),
		country: belongsTo(() => Country, "countryId"),
		tags: morphToMany(() => Tag, "taggable", {
			through: "taggables",
			foreignPivotKey: "taggableId",
			relatedPivotKey: "tagId",
		}),
	};
}

class Post extends orm.model("posts") {
	static softDeletes = true;
	static relations = {
		author: belongsTo(() => User, "userId"),
		comments: morphMany(() => Comment, "commentable"),
		latestComment: morphOne(() => Comment, "commentable"),
		tags: morphToMany(() => Tag, "taggable", {
			through: "taggables",
			foreignPivotKey: "taggableId",
			relatedPivotKey: "tagId",
		}),
	};
}

class Profile extends orm.model("profiles") {
	static relations = {
		user: belongsTo(() => User, "userId"),
	};
}

class Comment extends orm.model("comments") {
	static relations = {
		commentable: morphTo("commentable", () => ({
			posts: Post,
			videos: Video,
		})),
	};
}

class Video extends orm.model("videos") {
	static relations = {
		comments: morphMany(() => Comment, "commentable"),
	};
}

class Tag extends orm.model("tags") {}

const seeded = {
	egypt: 0,
	france: 0,
	ada: 0,
	grace: 0,
	alan: 0,
	p1: 0,
	p2: 0,
	p3: 0,
	p4: 0,
	php: 0,
	ts: 0,
	sql: 0,
	video: 0,
};

const mainEmails = ["ada@example.com", "grace@example.com", "alan@example.com"];

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
		t.text("password").nullable();
		t.text("secret").nullable();
		t.string("nickname", 120).nullable();
		t.json("permissions").nullable();
		t.json("settings").nullable();
		t.integer("countryId").nullable();
		t.datetime("deletedAt").nullable();
		t.timestamps();
	});
	await ddl.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title", 190);
		t.integer("views").default(0);
		t.boolean("published").default(false);
		t.datetime("deletedAt").nullable();
		t.timestamps();
	});
	await ddl.create("profiles", (t) => {
		t.id();
		t.integer("userId");
		t.text("bio").nullable();
	});
	await ddl.create("comments", (t) => {
		t.id();
		t.string("body", 190);
		t.integer("commentableId");
		t.string("commentableType", 60);
	});
	await ddl.create("videos", (t) => {
		t.id();
		t.string("title", 190);
	});
	await ddl.create("tags", (t) => {
		t.id();
		t.string("name", 60);
	});
	await ddl.create("taggables", (t) => {
		t.integer("taggableId");
		t.integer("taggableType");
		t.integer("tagId");
	});

	const egypt = await Country.create({ name: "Egypt" });
	const france = await Country.create({ name: "France" });
	seeded.egypt = egypt.get("id") as number;
	seeded.france = france.get("id") as number;

	const ada = await User.create({
		name: "Ada",
		email: "  ADA@Example.COM ",
		password: "secret-pw",
		secret: "top-secret",
		nickname: "@ada",
		permissions: ["admin", "author"],
		settings: { theme: "dark", nested: { a: 1 } },
		countryId: seeded.egypt,
	});
	const grace = await User.create({
		name: "Grace",
		email: "grace@example.com",
		countryId: seeded.france,
	});
	const alan = await User.create({
		name: "Alan",
		email: "alan@example.com",
	});
	seeded.ada = ada.get("id") as number;
	seeded.grace = grace.get("id") as number;
	seeded.alan = alan.get("id") as number;

	const posts = await Post.createMany([
		{
			userId: seeded.ada,
			title: "Hello world",
			views: 10,
			published: true,
		},
		{ userId: seeded.ada, title: "Draft", views: 5, published: false },
		{ userId: seeded.grace, title: "Compilers", views: 20, published: true },
		{ userId: seeded.grace, title: "Notes", views: 0, published: false },
	]);
	seeded.p1 = posts[0]!.get("id") as number;
	seeded.p2 = posts[1]!.get("id") as number;
	seeded.p3 = posts[2]!.get("id") as number;
	seeded.p4 = posts[3]!.get("id") as number;

	await Profile.create({ userId: seeded.ada, bio: "First programmer" });

	const php = await Tag.create({ name: "php" });
	const ts = await Tag.create({ name: "ts" });
	const sql = await Tag.create({ name: "sql" });
	seeded.php = php.get("id") as number;
	seeded.ts = ts.get("id") as number;
	seeded.sql = sql.get("id") as number;
	await orm.table("taggables").insert([
		{ taggableId: seeded.ada, taggableType: "users", tagId: seeded.php },
		{ taggableId: seeded.ada, taggableType: "users", tagId: seeded.ts },
		{ taggableId: seeded.grace, taggableType: "users", tagId: seeded.sql },
		{ taggableId: seeded.p1, taggableType: "posts", tagId: seeded.ts },
	]);

	await Comment.create({
		body: "first comment",
		commentableId: seeded.p1,
		commentableType: "posts",
	});
	await Comment.create({
		body: "second comment",
		commentableId: seeded.p1,
		commentableType: "posts",
	});
	const video = await Video.create({ title: "Intro" });
	seeded.video = video.get("id") as number;
	await Comment.create({
		body: "video comment",
		commentableId: seeded.video,
		commentableType: "videos",
	});
}

beforeAll(async () => {
	await seed();
});

let sequence = 0;

/** A unique fixture email for isolated tests. */
function uniqueEmail(label: string): string {
	sequence += 1;
	return `${label}-${sequence}@fixtures.test`;
}

/** Creates an isolated user (unique email) for destructive tests. */
async function freshUser(label: string): Promise<User> {
	return User.create({ name: label, email: uniqueEmail(label) });
}

describe("batch 1 — increment / firstOrCreate / getOriginal / replicate", () => {
	test("increment and decrement are atomic and report affected rows", async () => {
		const owner = await freshUser("counter");
		const a = await Post.create({
			userId: owner.get("id"),
			title: "counter-a",
			views: 10,
		});
		const b = await Post.create({
			userId: owner.get("id"),
			title: "counter-b",
			views: 5,
		});
		const affected = await Post.query()
			.whereIn("id", [a.get("id"), b.get("id")])
			.increment("views", 3, { published: true });
		expect(affected).toBe(2);
		const afterIncrement = await Post.query()
			.whereIn("id", [a.get("id"), b.get("id")])
			.orderBy("id")
			.get();
		expect(afterIncrement.map((post) => post.get("views")).all()).toEqual([
			13, 8,
		]);
		expect(afterIncrement.every((post) => post.get("published") === true)).toBe(
			true,
		);
		const decremented = await Post.query()
			.where("id", a.get("id"))
			.decrement("views", 4);
		expect(decremented).toBe(1);
		expect((await Post.find(a.get("id")))?.get("views")).toBe(9);
	});

	test("increment validates its inputs", async () => {
		await expect(Post.query().increment("title" as never)).rejects.toThrow(
			InvalidQueryError,
		);
		await expect(Post.query().increment("views", Number.NaN)).rejects.toThrow(
			InvalidQueryError,
		);
		await expect(
			Post.query().increment("views", 1, { views: 5 } as never),
		).rejects.toThrow(InvalidQueryError);
		await expect(Post.query().increment("id" as never, 1)).rejects.toThrow(
			InvalidQueryError,
		);
	});

	test("firstOrCreate returns the existing row or creates once", async () => {
		const email = uniqueEmail("first-or-create");
		const created = await User.firstOrCreate({ email }, { name: "Created" });
		expect(created.get("name")).toBe("Created");
		expect(created.get("email")).toBe(email);
		const again = await User.firstOrCreate({ email }, { name: "Ignored" });
		expect(again.get("id")).toBe(created.get("id"));
		expect(again.get("name")).toBe("Created");
	});

	test("updateOrCreate creates then updates the same row", async () => {
		const email = uniqueEmail("update-or-create");
		const created = await User.updateOrCreate({ email }, { name: "Before" });
		const updated = await User.updateOrCreate({ email }, { name: "After" });
		expect(updated.get("id")).toBe(created.get("id"));
		expect(updated.get("name")).toBe("After");
		const count = await User.query().where("email", email).count();
		expect(count).toBe(1);
	});

	test("getOriginal, getDirty and replicate", async () => {
		const user = await freshUser("original");
		user.set("name", "Updated name");
		expect(user.getDirty()).toEqual({ name: "Updated name" });
		expect(user.getOriginal("name")).not.toBe("Updated name");
		await user.save();
		expect(user.getOriginal("name")).toBe("Updated name");
		expect(user.getDirty()).toEqual({});

		const copy = await user.replicate(["email"]);
		expect(copy.get("id")).toBeUndefined();
		expect(copy.get("name")).toBe("Updated name");
		const attributes = copy.attributes();
		expect(attributes.id).toBeUndefined();
		expect(attributes.email).toBeUndefined();
		expect(attributes.createdAt).toBeUndefined();
		expect(attributes.updatedAt).toBeUndefined();
		expect(attributes.deletedAt).toBeUndefined();
		copy.set("email", uniqueEmail("replica"));
		await copy.save();
		expect(copy.get("id")).not.toBe(user.get("id"));
		expect(await User.query().where("name", "Updated name").count()).toBe(2);
	});
});

describe("batch 2 — aggregates and relation filters", () => {
	test("withCount and withSum/withAvg/withMin/withMax", async () => {
		const user = await User.query()
			.withCount("posts")
			.withCount("posts as aliasedCount")
			.withSum("posts", "views")
			.withAvg("posts", "views")
			.withMin("posts", "views")
			.withMax("posts", "views")
			.withSum("posts as aliasedSum", "views")
			.where("id", seeded.ada)
			.firstOrFail();
		expect(user.postsCount).toBe(2);
		expect(user.aliasedCount).toBe(2);
		expect(user.postsSumViews).toBe(15);
		expect(user.postsAvgViews).toBe(7.5);
		expect(user.postsMinViews).toBe(5);
		expect(user.postsMaxViews).toBe(10);
		expect(user.aliasedSum).toBe(15);
	});

	test("aggregates on empty and polymorphic relations", async () => {
		const alan = await User.query()
			.withCount("posts")
			.withSum("posts", "views")
			.where("id", seeded.alan)
			.firstOrFail();
		expect(alan.postsCount).toBe(0);
		expect(alan.postsSumViews).toBeNull();
		const ada = await User.query()
			.withCount("tags")
			.where("id", seeded.ada)
			.firstOrFail();
		expect(ada.tagsCount).toBe(2);
		const post = await Post.query()
			.withCount("tags")
			.where("id", seeded.p1)
			.firstOrFail();
		expect(post.tagsCount).toBe(1);
		const country = await Country.query()
			.withCount("posts")
			.where("id", seeded.egypt)
			.firstOrFail();
		expect(country.postsCount).toBe(2);
	});

	test("aggregate validation errors", () => {
		expect(() => User.query().withCount("nope" as never)).toThrow(
			InvalidQueryError,
		);
		expect(() => User.query().withSum("posts", "nope" as never)).toThrow(
			InvalidQueryError,
		);
		expect(() =>
			User.query().withMin("nope" as never, "views" as never),
		).toThrow(InvalidQueryError);
	});

	test("whereHas filters, with nesting, negation and or", async () => {
		const published = await User.query()
			.whereIn("email", mainEmails)
			.whereHas("posts", (group) => group.where("published", true))
			.orderBy("id")
			.get();
		expect(published.map((user) => user.get("name")).all()).toEqual([
			"Ada",
			"Grace",
		]);

		const heavy = await User.query()
			.whereIn("email", mainEmails)
			.whereHas("posts", (group) =>
				group.where("published", true).where("views", ">", 15),
			)
			.get();
		expect(heavy.map((user) => user.get("name")).all()).toEqual(["Grace"]);

		const nested = await User.query()
			.whereIn("email", mainEmails)
			.whereHas("posts.comments")
			.get();
		expect(nested.map((user) => user.get("name")).all()).toEqual(["Ada"]);

		const nestedConstrained = await User.query()
			.whereIn("email", mainEmails)
			.whereHas("posts.comments", (group) =>
				group.where("body", "second comment"),
			)
			.get();
		expect(nestedConstrained.map((user) => user.get("name")).all()).toEqual([
			"Ada",
		]);

		const without = await User.query()
			.whereIn("email", mainEmails)
			.whereDoesntHave("posts")
			.get();
		expect(without.map((user) => user.get("name")).all()).toEqual(["Alan"]);

		// OR variants span the whole table (SQL precedence), so assert the
		// exact set algebra against separately counted predicates.
		const withPostsCount = await User.query().whereHas("posts").count();
		const orHas = await User.query()
			.where("id", seeded.alan)
			.orWhereHas("posts")
			.get();
		expect(orHas).toHaveLength(withPostsCount + 1);
		expect(orHas.some((user) => user.get("id") === seeded.alan)).toBe(true);

		const withoutPostsCount = await User.query()
			.whereDoesntHave("posts")
			.count();
		const orDoesnt = await User.query()
			.where("id", seeded.grace)
			.orWhereDoesntHave("posts")
			.get();
		expect(orDoesnt).toHaveLength(withoutPostsCount + 1);
		expect(orDoesnt.some((user) => user.get("id") === seeded.grace)).toBe(true);
		expect(orDoesnt.some((user) => user.get("id") === seeded.alan)).toBe(true);
	});

	test("whereHas works for morphs and through relations", async () => {
		const withComments = await Post.query()
			.where("id", seeded.p1)
			.whereHas("comments")
			.get();
		expect(withComments).toHaveLength(1);
		const withoutComments = await Post.query()
			.where("id", seeded.p2)
			.whereHas("comments")
			.get();
		expect(withoutComments).toHaveLength(0);

		const morphable = await Comment.query().whereHas("commentable").get();
		expect(morphable).toHaveLength(3);
		await Comment.create({
			body: "orphan",
			commentableId: 999_999,
			commentableType: "posts",
		});
		expect(await Comment.query().whereHas("commentable").count()).toBe(3);
		await Comment.query().where("body", "orphan").forceDelete();

		const countries = await Country.query()
			.whereHas("posts", (group) => group.where("published", true))
			.orderBy("id")
			.get();
		expect(countries.map((country) => country.get("name")).all()).toEqual([
			"Egypt",
			"France",
		]);
	});

	test("whereHas validation", async () => {
		expect(() => User.query().whereHas("nope" as never)).toThrow(
			InvalidQueryError,
		);
		expect(() => User.query().whereHas("posts.nope" as never)).toThrow(
			InvalidQueryError,
		);
		expect(() =>
			Comment.query().whereHas(
				"commentable",
				((group: never) => group) as never,
			),
		).toThrow(InvalidQueryError);
		expect(() => orm.table("users").whereHas("posts" as never)).toThrow(
			InvalidQueryError,
		);
	});

	test("constrained eager loading", async () => {
		const ada = await User.query()
			.with({
				posts: (query) => query.where("published", true).orderBy("id"),
			})
			.where("id", seeded.ada)
			.firstOrFail();
		expect(ada.posts.map((post) => post.get("title")).all()).toEqual([
			"Hello world",
		]);

		const nested = await User.query()
			.with("posts.comments")
			.with({
				"posts.comments": (query) => query.where("body", "first comment"),
			})
			.where("id", seeded.ada)
			.firstOrFail();
		const comments = nested.posts.flatMap((post) => post.comments);
		expect(comments.map((comment) => comment.get("body")).all()).toEqual([
			"first comment",
		]);

		const constrainedHasOne = await User.query()
			.with({ profile: (query) => query.where("bio", "nope") })
			.where("id", seeded.ada)
			.firstOrFail();
		expect(constrainedHasOne.profile).toBeNull();

		expect(() =>
			Comment.query().with({
				commentable: (query: unknown) => query,
			} as never),
		).toThrow(InvalidQueryError);
		expect(() => User.query().with("nope" as never)).toThrow(InvalidQueryError);
	});

	test("eager loading is batched (no N+1)", async () => {
		const statements: string[] = [];
		const off = orm.onQuery((event) => statements.push(event.sql));
		try {
			await Post.query()
				.whereIn("id", [seeded.p1, seeded.p3])
				.with("author", "comments")
				.get();
		} finally {
			off();
		}
		expect(statements).toHaveLength(3);
		expect(
			statements.filter((sql) => sql.includes('from "posts"')),
		).toHaveLength(1);

		const morphStatements: string[] = [];
		const offMorph = orm.onQuery((event) => morphStatements.push(event.sql));
		try {
			await Comment.query()
				.whereIn("body", ["first comment", "video comment"])
				.with("commentable")
				.get();
		} finally {
			offMorph();
		}
		// one comments query + one query per morph type
		expect(morphStatements).toHaveLength(3);
	});
});

describe("batch 3 — events and observers", () => {
	test("lifecycle events fire in order", async () => {
		const seen: string[] = [];
		const off = User.on("saving", () => {
			seen.push("saving");
		});
		const offObserve = User.observe({
			creating: () => {
				seen.push("creating");
			},
			created: () => {
				seen.push("created");
			},
			updated: () => {
				seen.push("updated");
			},
			saved: () => {
				seen.push("saved");
			},
		});
		try {
			const user = await freshUser("events");
			expect(seen).toEqual(["saving", "creating", "created", "saved"]);
			seen.length = 0;
			await user.update({ name: "events updated" });
			expect(seen).toEqual(["saving", "updated", "saved"]);
		} finally {
			off();
			offObserve();
		}
	});

	test("retrieved fires once per hydrated row", async () => {
		let retrieved = 0;
		const off = Post.on("retrieved", () => {
			retrieved += 1;
		});
		try {
			await Post.query().whereIn("id", [seeded.p1, seeded.p3]).get();
		} finally {
			off();
		}
		expect(retrieved).toBe(2);
	});

	test("gate events cancel the operation", async () => {
		const offCreating = User.on("creating", () => false);
		try {
			const cancelled = await User.create({
				name: "Cancelled",
				email: "cancelled@fixtures.test",
			});
			expect(cancelled.get("id")).toBeUndefined();
			expect(
				await User.query().where("email", "cancelled@fixtures.test").count(),
			).toBe(0);
		} finally {
			offCreating();
		}

		const user = await freshUser("gate");
		const offUpdating = User.on("updating", () => false);
		try {
			user.set("name", "Should not persist");
			expect(await user.save()).toBe(false);
			expect((await User.find(user.get("id")))?.get("name")).not.toBe(
				"Should not persist",
			);
		} finally {
			offUpdating();
		}

		const offDeleting = User.on("deleting", () => false);
		try {
			expect(await user.delete()).toBe(false);
			expect(user.trashed()).toBe(false);
			expect(await User.query().where("id", user.get("id")).count()).toBe(1);
		} finally {
			offDeleting();
		}
	});

	test("soft-delete gates cancel restore and forceDelete", async () => {
		const user = await freshUser("gates");
		await user.delete();
		const offRestoring = User.on("restoring", () => false);
		try {
			expect(await user.restore()).toBe(false);
			expect(user.trashed()).toBe(true);
		} finally {
			offRestoring();
		}
		const offForce = User.on("forceDeleting", () => false);
		try {
			expect(await user.forceDelete()).toBe(false);
			expect(await User.withTrashed().where("id", user.get("id")).count()).toBe(
				1,
			);
		} finally {
			offForce();
		}
	});

	test("withoutEvents suppresses every listener", async () => {
		let fired = 0;
		const off = User.on("created", () => {
			fired += 1;
		});
		try {
			const user = await User.withoutEvents(async () =>
				User.create({
					name: "Quiet",
					email: "quiet-events@fixtures.test",
				}),
			);
			expect(await User.withoutEvents(() => user.delete())).toBe(true);
			expect(fired).toBe(0);
		} finally {
			off();
		}
	});

	test("unsubscribe and validation", async () => {
		let fired = 0;
		const off = User.on("created", () => {
			fired += 1;
		});
		off();
		await freshUser("unsubscribed");
		expect(fired).toBe(0);
		expect(() => User.on("nope" as never, (() => true) as never)).toThrow(
			InvalidModelUsageError,
		);
		expect(() => User.observe({ created: "nope" } as never)).toThrow(
			InvalidModelUsageError,
		);
	});

	test("soft delete fires trashed and deleted", async () => {
		const user = await freshUser("delete-events");
		const seen: string[] = [];
		const off = User.observe({
			deleting: () => {
				seen.push("deleting");
			},
			trashed: () => {
				seen.push("trashed");
			},
			deleted: () => {
				seen.push("deleted");
			},
			restoring: () => {
				seen.push("restoring");
			},
			restored: () => {
				seen.push("restored");
			},
		});
		try {
			await user.delete();
			expect(seen).toEqual(["deleting", "trashed", "deleted"]);
			seen.length = 0;
			await user.restore();
			expect(seen).toContain("restoring");
			expect(seen).toContain("restored");
		} finally {
			off();
		}
	});
});

describe("batch 4 — soft deletes", () => {
	test("model delete, restore and forceDelete", async () => {
		const user = await freshUser("soft-model");
		expect(user.trashed()).toBe(false);
		expect(await user.restore()).toBe(false);
		expect(await user.delete()).toBe(true);
		expect(user.trashed()).toBe(true);
		expect(await User.find(user.get("id"))).toBeNull();
		expect(await User.withTrashed().where("id", user.get("id")).count()).toBe(
			1,
		);
		expect(await User.onlyTrashed().where("id", user.get("id")).count()).toBe(
			1,
		);
		expect(await user.restore()).toBe(true);
		expect(user.trashed()).toBe(false);
		expect(await User.find(user.get("id"))).not.toBeNull();
		expect(await user.forceDelete()).toBe(true);
		expect(await User.withTrashed().where("id", user.get("id")).count()).toBe(
			0,
		);
	});

	test("builder-level soft delete, restore and forceDelete", async () => {
		const user = await freshUser("soft-builder");
		const titles = ["soft-a", "soft-b", "soft-c"];
		for (const title of titles) {
			await Post.create({
				userId: user.get("id"),
				title,
				views: 1,
			});
		}
		const deleted = await Post.query().whereIn("title", titles).delete();
		expect(deleted).toBe(3);
		expect(await Post.query().whereIn("title", titles).count()).toBe(0);
		expect(await Post.withTrashed().whereIn("title", titles).count()).toBe(3);
		expect(await Post.onlyTrashed().whereIn("title", titles).count()).toBe(3);
		const restored = await Post.onlyTrashed()
			.whereIn("title", titles)
			.restore();
		expect(restored).toBe(3);
		expect(await Post.query().whereIn("title", titles).count()).toBe(3);
		const removed = await Post.query().whereIn("title", titles).forceDelete();
		expect(removed).toBe(3);
		expect(await Post.withTrashed().whereIn("title", titles).count()).toBe(0);
	});

	test("soft-delete scopes apply to reads, counts and pagination", async () => {
		const user = await freshUser("soft-scope");
		await Post.create({
			userId: user.get("id"),
			title: "scope-live",
			views: 2,
		});
		const trashed = await Post.create({
			userId: user.get("id"),
			title: "scope-trashed",
			views: 3,
		});
		await trashed.delete();
		expect(await Post.query().where("userId", user.get("id")).count()).toBe(1);
		expect(
			await Post.withTrashed().where("userId", user.get("id")).count(),
		).toBe(2);
		expect(await Post.query().where("userId", user.get("id")).exists()).toBe(
			true,
		);
		const page = await Post.query()
			.where("userId", user.get("id"))
			.paginate(10, 1);
		expect(page.total).toBe(1);
		expect(page.data).toHaveLength(1);
	});

	test("eager loading respects and can override soft-delete scopes", async () => {
		const user = await freshUser("soft-eager");
		await Post.create({
			userId: user.get("id"),
			title: "eager-live",
			views: 1,
		});
		const trashed = await Post.create({
			userId: user.get("id"),
			title: "eager-trashed",
			views: 1,
		});
		await trashed.delete();

		const normal = await User.query()
			.with("posts")
			.where("id", user.get("id"))
			.firstOrFail();
		expect(normal.posts.map((post) => post.get("title")).all()).toEqual([
			"eager-live",
		]);

		const including = await User.query()
			.with({ posts: (query) => query.withTrashed().orderBy("id") })
			.where("id", user.get("id"))
			.firstOrFail();
		expect(including.posts.map((post) => post.get("title")).all()).toEqual([
			"eager-live",
			"eager-trashed",
		]);

		const trashedUser = await freshUser("soft-eager-parent");
		await Post.create({
			userId: trashedUser.get("id"),
			title: "child-of-trashed",
			views: 1,
		});
		await trashedUser.delete();
		expect(
			await User.query()
				.with("posts")
				.where("id", trashedUser.get("id"))
				.first(),
		).toBeNull();
		const visibleParent = await User.withTrashed()
			.with("posts")
			.where("id", trashedUser.get("id"))
			.firstOrFail();
		expect(visibleParent.posts).toHaveLength(1);
	});

	test("soft-delete runtime validation", async () => {
		expect(() => Profile.query().withTrashed()).toThrow(InvalidQueryError);
		expect(() => orm.table("tags").withTrashed()).toThrow(InvalidQueryError);
		await expect(Profile.query().restore()).rejects.toThrow(InvalidQueryError);
		const tag = await Tag.create({ name: "not-soft" });
		expect(() => tag.trashed()).toThrow(InvalidModelUsageError);
		expect(await tag.delete()).toBe(true);
		expect(await Tag.query().where("id", tag.get("id")).count()).toBe(0);
		expect(() => Tag.query().withTrashed()).toThrow(InvalidQueryError);
	});
});

describe("batch 5 — polymorphic and through relations", () => {
	test("morphMany, morphOne and morphTo eager loading", async () => {
		const post = await Post.query()
			.with("comments", "latestComment")
			.where("id", seeded.p1)
			.firstOrFail();
		expect(post.comments.map((comment) => comment.get("body")).all()).toEqual([
			"first comment",
			"second comment",
		]);
		expect(post.latestComment?.get("body")).toBe("first comment");
		expect(post.comments[0]?.get("commentableType")).toBe("posts");

		const video = await Video.query()
			.with("comments")
			.where("id", seeded.video)
			.firstOrFail();
		expect(video.comments.map((comment) => comment.get("body")).all()).toEqual([
			"video comment",
		]);

		const comments = await Comment.query()
			.with("commentable")
			.orderBy("id")
			.get();
		expect(
			comments.map((comment) => comment.commentable?.constructor.name).all(),
		).toEqual(["Post", "Post", "Video"]);
		const orphan = await Comment.create({
			body: "orphan-morph",
			commentableId: 999_999,
			commentableType: "posts",
		});
		const orphanLoaded = await Comment.query()
			.with("commentable")
			.where("id", orphan.get("id"))
			.firstOrFail();
		expect(orphanLoaded.commentable).toBeNull();
		await orphan.forceDelete();
	});

	test("morphToMany eager loading, counting and filtering", async () => {
		const ada = await User.query()
			.with("tags")
			.where("id", seeded.ada)
			.firstOrFail();
		expect(
			ada.tags
				.map((tag) => tag.get("name"))
				.sort()
				.all(),
		).toEqual(["php", "ts"]);
		const post = await Post.query()
			.with("tags")
			.where("id", seeded.p1)
			.firstOrFail();
		expect(post.tags.map((tag) => tag.get("name")).all()).toEqual(["ts"]);
		const owners = await User.query()
			.whereIn("email", mainEmails)
			.whereHas("tags", (group) => group.where("name", "php"))
			.get();
		expect(owners.map((user) => user.get("name")).all()).toEqual(["Ada"]);
	});

	test("hasManyThrough and hasOneThrough eager loading", async () => {
		const country = await Country.query()
			.with("posts", "users")
			.with({ latestPost: (query) => query.orderBy("id", "desc") })
			.where("id", seeded.egypt)
			.firstOrFail();
		expect(
			country.posts
				.map((post) => post.get("title"))
				.sort()
				.all(),
		).toEqual(["Draft", "Hello world"]);
		expect(country.latestPost?.get("title")).toBe("Draft");
		expect(country.users.map((user) => user.get("name")).all()).toEqual([
			"Ada",
		]);
	});

	test("constrained through relations use one extra query", async () => {
		const statements: string[] = [];
		const off = orm.onQuery((event) => statements.push(event.sql));
		let constrainedTitles: string[] = [];
		try {
			const country = await Country.query()
				.with({
					posts: (query) =>
						query.where("published", true).orderBy("title", "desc"),
				})
				.where("id", seeded.egypt)
				.firstOrFail();
			constrainedTitles = country.posts.map((post) => post.get("title"));
		} finally {
			off();
		}
		expect(constrainedTitles).toEqual(["Hello world"]);
		expect(statements).toHaveLength(3);

		const plainStatements: string[] = [];
		const offPlain = orm.onQuery((event) => plainStatements.push(event.sql));
		try {
			await Country.query()
				.with("posts")
				.where("id", seeded.egypt)
				.firstOrFail();
		} finally {
			offPlain();
		}
		expect(plainStatements).toHaveLength(2);
	});

	test("through relations respect soft deletes and withTrashed constraints", async () => {
		const country = await Country.create({ name: "Soft country" });
		const user = await User.create({
			name: "Through soft",
			email: uniqueEmail("through-soft"),
			countryId: country.get("id"),
		});
		await Post.create({
			userId: user.get("id"),
			title: "through-live",
			views: 1,
		});
		const trashed = await Post.create({
			userId: user.get("id"),
			title: "through-trashed",
			views: 1,
		});
		await trashed.delete();

		const normal = await Country.query()
			.with("posts")
			.where("id", country.get("id"))
			.firstOrFail();
		expect(normal.posts.map((post) => post.get("title")).all()).toEqual([
			"through-live",
		]);

		const including = await Country.query()
			.with({ posts: (query) => query.withTrashed().orderBy("id") })
			.where("id", country.get("id"))
			.firstOrFail();
		expect(including.posts.map((post) => post.get("title")).all()).toEqual([
			"through-live",
			"through-trashed",
		]);
	});
});

describe("batch 6 — accessors, mutators, casts and visibility", () => {
	test("accessors, appends and mutators", async () => {
		const ada = await User.find(seeded.ada);
		expect(ada).not.toBeNull();
		const typed = ada as User & { displayName: string };
		expect(typed.displayName).toBe("Ada <ada@example.com>");
		const json = ada!.toJSON() as Record<string, unknown>;
		expect(json.displayName).toBe("Ada <ada@example.com>");
		expect(json.password).toBeUndefined();
		expect(json.secret).toBeUndefined();
		expect(ada!.get("email")).toBe("ada@example.com");

		const created = await User.create({
			name: "Mutated",
			email: "  MUTATED@Example.COM ",
		});
		expect(created.get("email")).toBe("mutated@example.com");
		await created.update({ email: "NEXT@Example.COM " });
		expect(created.get("email")).toBe("next@example.com");
	});

	test("accessors are only serialized through appends", async () => {
		class QuietUser extends orm.model("users") {
			static accessors = {
				label: (user: QuietUser) => String(user.get("name")),
			};
			static casts = {} as const;
		}
		const user = await QuietUser.query().where("id", seeded.ada).firstOrFail();
		expect((user as QuietUser & { label: string }).label).toBe("Ada");
		expect((user.toJSON() as Record<string, unknown>).label).toBeUndefined();
	});

	test("visible / hidden / makeHidden / makeVisible", async () => {
		class VisibleUser extends orm.model("users") {
			static visible = ["id", "name"] as const;
		}
		const user = await VisibleUser.query()
			.where("id", seeded.ada)
			.firstOrFail();
		expect(Object.keys(user.toJSON())).toEqual(["id", "name"]);
		user.makeHidden("name");
		expect(Object.keys(user.toJSON())).toEqual(["id"]);
		user.makeVisible("name");
		expect(Object.keys(user.toJSON())).toEqual(["id", "name"]);

		const ada = await User.find(seeded.ada);
		ada!.makeHidden("email");
		expect((ada!.toJSON() as Record<string, unknown>).email).toBeUndefined();
		ada!.makeVisible("secret");
		expect((ada!.toJSON() as Record<string, unknown>).secret).toBe(
			"top-secret",
		);
	});

	test("json / array / custom / encrypted / hashed casts round-trip", async () => {
		const user = await User.create({
			name: "Casts",
			email: uniqueEmail("casts"),
			password: "hunter2",
			secret: "classified",
			nickname: "@casts",
			permissions: ["read", "write"],
			settings: { nested: { enabled: true } },
		});
		expect(user.get("permissions")).toEqual(["read", "write"]);
		expect(user.get("settings")).toEqual({ nested: { enabled: true } });
		expect(user.get("nickname")).toBe("@casts");
		expect(user.get("secret")).toBe("classified");
		expect(verifyHashedValue("hunter2", user.get("password"))).toBe(true);
		expect(verifyHashedValue("wrong", user.get("password"))).toBe(false);

		const stored = await orm.table("users").where("id", user.get("id")).first();
		expect(String(stored?.password)).toStartWith("scrypt:");
		expect(String(stored?.secret)).toStartWith("v1:");
		expect(String(stored?.secret)).not.toContain("classified");

		const reloaded = await User.find(user.get("id"));
		expect(reloaded?.get("permissions")).toEqual(["read", "write"]);
		expect(reloaded?.get("secret")).toBe("classified");

		// Assigning the stored hash back must not hash it twice.
		const hash = user.get("password");
		await user.update({ password: hash });
		expect(verifyHashedValue("hunter2", user.get("password"))).toBe(true);
	});

	test("cast validation", async () => {
		const user = await freshUser("cast-errors");
		await orm
			.table("users")
			.where("id", user.get("id"))
			.update({ secret: "not-an-encrypted-payload" } as never);
		await expect(User.find(user.get("id"))).rejects.toThrow(CastError);
	});

	test("encrypted cast requires an encryption key", async () => {
		const noKey = new Orm({ schema, dialect: sqlite(":memory:") });
		class NoKeyUser extends noKey.model("users") {
			static casts = { secret: "encrypted" } as const;
		}
		await noKey.raw(
			"create table users (id integer primary key autoincrement, secret text)",
		);
		await noKey.raw("insert into users (secret) values ('x')");
		await expect(NoKeyUser.query().first()).rejects.toThrow(SchemaError);
	});

	test("accessor collisions and invalid casts are rejected", async () => {
		class BadAccessor extends orm.model("users") {
			static accessors = {
				id: (user: BadAccessor) => user.get("id"),
			};
		}
		await expect(BadAccessor.query().first()).rejects.toThrow(SchemaError);

		class BadCast extends orm.model("users") {
			static casts = { name: "nope" } as const;
		}
		await expect(BadCast.query().first()).rejects.toThrow(SchemaError);
	});
});
