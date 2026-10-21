// Eloquent parity — the API surface that was added last.
//
// Covers the model metadata getters, dirty-tracking helpers, relation
// bookkeeping, `Attribute` accessor objects, the `casts()` method form,
// per-query `withCasts()` overrides, strict mode, `withoutCasting` /
// `withoutTouching`, ULID/UUID primary keys and `whereMorphRelation()`.

import { beforeAll, describe, expect, test } from "bun:test";
import {
	Attribute,
	belongsTo,
	defineSchema,
	hasMany,
	InvalidModelUsageError,
	isUlid,
	morphTo,
	Orm,
	RelationNotLoadedError,
	SchemaError,
} from "../../src/index";
import { sqlite } from "../../src/sqlite";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		age: { type: "integer", nullable: true },
		settings: { type: "json", nullable: true },
		nickname: { type: "string", nullable: true },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		published: { type: "boolean", default: false },
	},
	videos: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		title: "string",
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		commentableId: { type: "integer", nullable: true },
		commentableType: { type: "string", nullable: true },
		body: "string",
	},
	tickets: {
		id: { type: "string", primaryKey: true },
		subject: "string",
	},
});

const orm = new Orm({
	schema,
	dialect: sqlite(":memory:"),
	encryptionKey: "eloquent-extra-key",
});

class Post extends orm.model("posts") {
	static fillable = ["userId", "title", "views", "published"] as const;
	static relations = {
		author: belongsTo(() => User, "userId"),
	};
	static touches = ["author"] as const;
}

class Video extends orm.model("videos") {
	static fillable = ["title"] as const;
}

class User extends orm.model("users") {
	static fillable = ["name", "email", "age", "settings", "nickname"] as const;
	static casts = { settings: "collection" as const };
	static relations = {
		posts: hasMany(() => Post, "userId"),
	};
}

class Comment extends orm.model("comments") {
	static fillable = ["commentableId", "commentableType", "body"] as const;
	static relations = {
		commentable: morphTo("commentable", () => ({
			posts: Post,
			videos: Video,
		})),
	};
}

/** A model that declares its casts through the `casts()` method. */
class Document extends orm.model("users") {
	static fillable = ["name", "email", "settings"] as const;
	static casts() {
		return { settings: "collection" as const };
	}
}

/** A model with ULID primary keys. */
class Ticket extends orm.model("tickets") {
	static fillable = ["id", "subject"] as const;
	static usesUniqueIds = "ulid" as const;
}

/** A model with UUID primary keys. */
class Token extends orm.model("tickets") {
	static fillable = ["id", "subject"] as const;
	static usesUniqueIds = "uuid" as const;
}

/** Attribute-object accessor and mutator. */
class Person extends orm.model("users") {
	static fillable = ["name", "email", "nickname"] as const;
	static accessors = {
		displayName: new Attribute({
			get: (person: { get(name: string): unknown }) =>
				`${String(person.get("name"))} (${String(person.get("nickname"))})`,
		}),
	};
	static mutators = {
		nickname: new Attribute({
			set: (value: string) => value.trim().toLowerCase(),
		}),
	};
}

/** Strict-mode model: every check is enabled. */
class StrictUser extends orm.model("users") {
	static fillable = ["name", "email"] as const;
	static relations = {
		posts: hasMany(() => Post, "userId"),
	};
}

let adaId = 0;

async function seed(): Promise<void> {
	const builder = orm.schemaBuilder();
	await builder.create("users", (t) => {
		t.id();
		t.string("name", 120);
		t.string("email", 190);
		t.integer("age").nullable();
		t.json("settings").nullable();
		t.string("nickname").nullable();
		t.timestamps();
	});
	await builder.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title", 200);
		t.integer("views").default(0);
		t.boolean("published").default(false);
	});
	await builder.create("videos", (t) => {
		t.id();
		t.string("title", 200);
	});
	await builder.create("comments", (t) => {
		t.id();
		t.integer("commentableId").nullable();
		t.string("commentableType", 60).nullable();
		t.string("body", 200);
	});
	await builder.create("tickets", (t) => {
		t.string("id", 40);
		t.string("subject", 200);
	});

	const ada = await User.create({
		name: "Ada",
		email: "ada@example.com",
		age: 36,
		settings: ["dark"],
		nickname: "ada",
	});
	adaId = ada.get("id") as number;
	await Post.create({
		userId: adaId,
		title: "Engine",
		views: 10,
		published: true,
	});
	const video = await Video.create({ title: "Lecture" });
	await Comment.create({
		commentableId: adaId,
		commentableType: "posts",
		body: "on the post",
	});
	await Comment.create({
		commentableId: video.get("id") as number,
		commentableType: "videos",
		body: "on the video",
	});
}

beforeAll(async () => {
	await seed();
});

describe("model metadata", () => {
	test("the metadata getters describe the model", async () => {
		const user = await User.findOrFail(adaId);
		expect(user.getTable()).toBe("users");
		expect(user.getKeyName()).toBe("id");
		expect(user.getKeyType()).toBe("int");
		expect(user.getIncrementing()).toBe(true);
		expect(user.getQualifiedKeyName()).toBe("users.id");
		expect(user.getForeignKey()).toBe("users_id");
		expect(user.getRouteKeyName()).toBe("id");
		expect(user.getMorphClass()).toBe("users");
		expect(user.getKey()).toBe(adaId);
		expect(user.getFillable()).toEqual([
			"name",
			"email",
			"age",
			"settings",
			"nickname",
		]);
		expect(user.getGuarded()).toEqual([]);
		expect(user.getHidden()).toEqual([]);
		expect(user.getVisible()).toBeNull();
		expect(user.getAppends()).toEqual([]);
		expect(user.getCasts()).toEqual({ settings: "collection" });
		expect(user.getAttributes().name).toBe("Ada");
		expect(Object.keys(User.getGlobalScopes())).toEqual([]);
	});

	test("getAttribute / getAttributeValue / setAttribute work untyped", async () => {
		const user = await User.findOrFail(adaId);
		expect(user.getAttribute("name")).toBe("Ada");
		expect(user.getAttributeValue("name")).toBe("Ada");
		user.setAttribute("name", "Ada L.");
		expect(user.get("name")).toBe("Ada L.");
		expect(user.getAttributeValue("name")).toBe("Ada L.");
	});
});

describe("dirty tracking and relations", () => {
	test("wasChanged reports the last save", async () => {
		const user = await User.findOrFail(adaId);
		expect(user.wasChanged()).toBe(false);
		user.set("name", "Ada Lovelace");
		await user.save();
		expect(user.wasChanged()).toBe(true);
		expect(user.wasChanged("name")).toBe(true);
		expect(user.wasChanged("email")).toBe(false);
		await user.update({ name: "Ada" });
	});

	test("relations can be inspected and dropped", async () => {
		const user = await User.query()
			.where("id", adaId)
			.with("posts")
			.firstOrFail();
		expect(user.relationLoaded("posts")).toBe(true);
		expect(user.relationLoaded("comments")).toBe(false);
		expect(Object.keys(user.getRelations())).toEqual(["posts"]);
		expect(user.getRelations().posts).toBeDefined();

		user.unsetRelation("posts");
		expect(user.relationLoaded("posts")).toBe(false);
		expect(Object.keys(user.getRelations())).toEqual([]);

		const loaded = await User.query()
			.where("id", adaId)
			.with("posts")
			.firstOrFail();
		loaded.unsetRelations();
		expect(Object.keys(loaded.getRelations())).toEqual([]);
	});
});

describe("attribute objects", () => {
	test("an Attribute can declare an accessor and a mutator", async () => {
		const person = await Person.create({
			name: "Grace",
			email: "grace@example.com",
			nickname: "  GRACE  ",
		});
		expect(person.get("nickname")).toBe("grace");
		const display = (person as unknown as { displayName: string }).displayName;
		expect(display).toBe("Grace (grace)");
	});
});

describe("casts", () => {
	test("a model may declare its casts through the casts() method", async () => {
		const document = await Document.create({
			name: "Doc",
			email: "doc@example.com",
			settings: ["a"],
		});
		const settings = document.get("settings") as unknown as {
			all(): unknown[];
		};
		expect(settings.all()).toEqual(["a"]);
	});

	test("withCasts overrides the casts of one query", async () => {
		const row = await User.query()
			.where("id", adaId)
			.withCasts({ settings: "json" })
			.firstOrFail();
		// The override replaces the model's "collection" cast.
		expect(row.get("settings")).toEqual(["dark"]);

		// Without the override the model's own cast applies.
		const plain = await User.query().where("id", adaId).firstOrFail();
		const settings = plain.get("settings") as unknown as {
			all(): unknown[];
		};
		expect(settings.all()).toEqual(["dark"]);
	});

	test("withCasts rejects unknown columns", async () => {
		expect(() => User.query().withCasts({ nope: "json" } as never)).toThrow(
			SchemaError,
		);
	});
});

describe("strict mode", () => {
	test("shouldBeStrict turns every check on", async () => {
		StrictUser.shouldBeStrict();
		const strict = await StrictUser.create({
			name: "Strict",
			email: "strict@example.com",
		});
		expect(() => strict.get("nope" as never)).toThrow(InvalidModelUsageError);
		// "age" exists but is not fillable — the discarded attribute is reported.
		expect(() => strict.fill({ age: 30 } as never)).toThrow(
			InvalidModelUsageError,
		);
		const unloaded = await StrictUser.findOrFail(strict.get("id") as number);
		expect(() => (unloaded as unknown as { posts: unknown }).posts).toThrow(
			RelationNotLoadedError,
		);
		StrictUser.preventAccessingMissingAttributes(false);
		StrictUser.preventSilentlyDiscardingAttributes(false);
		StrictUser.preventLazyLoading(false);
	});

	test("a missing attribute is undefined outside strict mode", async () => {
		const user = await User.findOrFail(adaId);
		expect(user.get("nickname")).toBe("ada");
	});
});

describe("withoutCasting and withoutTouching", () => {
	test("withoutCasting suspends the casts", async () => {
		const document = await Document.create({
			name: "Doc",
			email: "doc2@example.com",
			settings: ["b"],
		});
		const raw = Document.withoutCasting(() => document.get("settings"));
		expect(raw).toEqual(["b"]);
		expect(
			(document.get("settings") as unknown as { all(): unknown[] }).all(),
		).toEqual(["b"]);
	});

	test("withoutTouching skips the owner timestamps", async () => {
		const user = await User.findOrFail(adaId);
		const before = user.get("updatedAt");
		await Post.withoutTouching(async () => {
			await Post.create({
				userId: adaId,
				title: "Untouched",
				views: 0,
			});
		});
		const reloaded = await User.findOrFail(adaId);
		expect(reloaded.get("updatedAt")).toEqual(before);

		// Without the wrapper the owner is touched.
		await Post.create({
			userId: adaId,
			title: "Touched",
			views: 0,
		});
		const touched = await User.findOrFail(adaId);
		expect(touched.get("updatedAt")).not.toEqual(before);
	});
});

describe("unique ids", () => {
	test("usesUniqueIds generates a ULID primary key", async () => {
		const ticket = await Ticket.create({ subject: "Broken" });
		const id = ticket.get("id") as string;
		expect(isUlid(id)).toBe(true);
		expect(id).toHaveLength(26);
	});

	test("usesUniqueIds generates a UUID primary key", async () => {
		const token = await Token.create({ subject: "Token" });
		expect(String(token.get("id"))).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	test("an explicit key wins over the generated one", async () => {
		const ticket = await Ticket.create({
			id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
			subject: "Explicit",
		});
		expect(ticket.get("id")).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
	});
});

describe("whereMorphRelation", () => {
	test("constrains a polymorphic relation by a target column", async () => {
		const comments = await Comment.query()
			.whereMorphRelation("commentable", "title", "=", "Lecture")
			.get();
		expect(comments.map((row) => row.get("body")).all()).toEqual([
			"on the video",
		]);
	});

	test("rejects relations that are not polymorphic", async () => {
		expect(() =>
			User.query().whereMorphRelation("posts", "title", "=", "x"),
		).toThrow();
	});
});
