// Factory parity integration suite (SQLite, in-memory, real driver).
//
// Covers the Eloquent `Database\Factories\Factory` surface added on top of
// the original define/state/count/create core: count/times, object and
// callback states, `for`/`recycle` (belongsTo), `has` (hasMany), `hasAttached`
// (belongsToMany), `sequence`, `afterMaking`/`afterCreating`/`after`,
// quiet creation, `configure`, `raw`/`states`, `createMany`/`makeMany`, and
// async definitions.

import { beforeAll, describe, expect, test } from "bun:test";
import {
	belongsTo,
	belongsToMany,
	Collection,
	defineSchema,
	Factory,
	hasMany,
	Orm,
	SchemaError,
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
		role: { type: "string", nullable: true },
		countryId: { type: "integer", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		postId: "integer",
		body: "string",
	},
	tags: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
	},
	post_tag: {
		postId: "integer",
		tagId: "integer",
	},
});

const orm = new Orm({ schema, dialect: sqlite(":memory:") });

class Country extends orm.model("countries") {
	static relations = {
		users: hasMany(() => User, "countryId"),
	};
}

class User extends orm.model("users") {
	static fillable = ["name", "email", "role", "countryId"] as const;
	static relations = {
		country: belongsTo(() => Country, "countryId"),
		posts: hasMany(() => Post, "userId"),
	};
}

class Post extends orm.model("posts") {
	static fillable = ["userId", "title", "views"] as const;
	static relations = {
		author: belongsTo(() => User, "userId"),
		comments: hasMany(() => Comment, "postId"),
		tags: belongsToMany(() => Tag, {
			through: "post_tag",
			foreignPivotKey: "postId",
			relatedPivotKey: "tagId",
		}),
	};
}

class Comment extends orm.model("comments") {
	static fillable = ["postId", "body"] as const;
	static relations = {
		post: belongsTo(() => Post, "postId"),
	};
}

class Tag extends orm.model("tags") {
	static fillable = ["name"] as const;
	static relations = {
		posts: belongsToMany(() => Post, {
			through: "post_tag",
			foreignPivotKey: "tagId",
			relatedPivotKey: "postId",
		}),
	};
}

beforeAll(async () => {
	const builder = orm.schemaBuilder();
	await builder.create("countries", (t) => {
		t.id();
		t.string("name");
	});
	await builder.create("users", (t) => {
		t.id();
		t.string("name");
		t.string("email");
		t.string("role").nullable();
		t.integer("countryId").nullable();
	});
	await builder.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title");
		t.integer("views").default(0);
	});
	await builder.create("comments", (t) => {
		t.id();
		t.integer("postId");
		t.string("body");
	});
	await builder.create("tags", (t) => {
		t.id();
		t.string("name");
	});
	await builder.create("post_tag", (t) => {
		t.integer("postId");
		t.integer("tagId");
	});
});

describe("factory parity — building", () => {
	test("count and its times alias build n instances", async () => {
		const three = await User.factory()
			.define({ name: "Count", email: (index) => `count${index}@x.com` })
			.count(3)
			.create();
		expect(three.count()).toBe(3);

		const two = User.factory()
			.define({ name: "Times", email: (index) => `times${index}@x.com` })
			.times(2)
			.make();
		expect(two.count()).toBe(2);
	});

	test("state accepts an object and a callback receiving attributes", async () => {
		const user = await User.factory()
			.define({ name: "Base", email: "base@x.com" })
			.state({ role: "editor" })
			.state((attributes) => ({ email: `sub-${attributes.name}@x.com` }))
			.createOne();
		expect(user.get("role")).toBe("editor");
		expect(user.get("email")).toBe("sub-Base@x.com");
	});

	test("sequence cycles attribute maps across rows", async () => {
		const users = await User.factory()
			.define({
				name: (index) => `Seq ${index}`,
				email: (index) => `seq${index}@x.com`,
			})
			.count(4)
			.sequence([{ role: "admin" }, { role: "user" }])
			.create();
		expect(users.all().map((user) => user.get("role"))).toEqual([
			"admin",
			"user",
			"admin",
			"user",
		]);
	});

	test("Factory.sequence cycles values inside a definition", async () => {
		const users = await User.factory()
			.define({
				name: (index) => `Inline ${index}`,
				email: (index) => `inline${index}@x.com`,
				role: Factory.sequence(["admin", "user"]),
			})
			.count(3)
			.create();
		expect(users.all().map((user) => user.get("role"))).toEqual([
			"admin",
			"user",
			"admin",
		]);
	});

	test("raw returns definition rows without consuming the sequence", () => {
		const factory = User.factory()
			.define({ name: (index) => `Raw ${index}`, email: "raw@x.com" })
			.state({ role: "user" })
			.count(2);
		const first = factory.raw();
		const second = factory.raw();
		expect(first.map((row) => row.name)).toEqual(["Raw 0", "Raw 1"]);
		expect(second.map((row) => row.name)).toEqual(["Raw 0", "Raw 1"]);
		expect(first[0]?.role).toBe("user");
		expect(factory.states()).toHaveLength(1);
	});

	test("createMany and makeMany build one model per definition", async () => {
		const made = User.factory().makeMany([
			{ name: "Many A", email: "many-a@x.com" },
			{ name: "Many B", email: "many-b@x.com" },
		]);
		expect(made.count()).toBe(2);
		expect(made.all().map((user) => user.get("name"))).toEqual([
			"Many A",
			"Many B",
		]);

		const created = await User.factory().createMany([
			{ name: "Many C", email: "many-c@x.com" },
			{ name: "Many D", email: "many-d@x.com" },
		]);
		expect(created.count()).toBe(2);
		expect(created.all().every((user) => user.get("id") !== undefined)).toBe(
			true,
		);
	});

	test("async definitions are awaited by create and rejected by make", async () => {
		const created = await User.factory()
			.define({ name: async () => "Async", email: "async@x.com" })
			.createOne();
		expect(created.get("name")).toBe("Async");

		const viaCallback = await User.factory()
			.define(async () => ({
				name: "Async Callback",
				email: "async-cb@x.com",
			}))
			.createOne();
		expect(viaCallback.get("name")).toBe("Async Callback");

		expect(() =>
			User.factory()
				.define({ name: async () => "Nope", email: "nope@x.com" })
				.make(),
		).toThrow(SchemaError);
	});
});

describe("factory parity — relationships", () => {
	test("for sets the belongsTo foreign key (auto-detected and named)", async () => {
		const country = await Country.create({ name: "Egypt" });

		const auto = await User.factory()
			.define({ name: "Auto", email: "auto@x.com" })
			.for(country)
			.createOne();
		expect(auto.get("countryId")).toBe(country.get("id"));

		const named = await User.factory()
			.define({ name: "Named", email: "named@x.com" })
			.for(country, "country")
			.createOne();
		expect(named.get("countryId")).toBe(country.get("id"));
	});

	test("for accepts a factory owner and reuses recycled instances", async () => {
		const country = await Country.create({ name: "Recycled" });
		const before = await Country.query().count();

		const user = await User.factory()
			.recycle(country)
			.for(Country.factory())
			.define({ name: "Recycled User", email: "recycled@x.com" })
			.createOne();

		expect(user.get("countryId")).toBe(country.get("id"));
		expect(await Country.query().count()).toBe(before);
	});

	test("has creates hasMany rows with the parent foreign key", async () => {
		const user = await User.factory()
			.define({ name: "Author", email: "author@x.com" })
			.has(
				Post.factory().define({ title: (index) => `Post ${index}` }),
				"posts",
				3,
			)
			.createOne();

		const userId = user.get("id");
		expect(
			await Post.query()
				.where("userId", userId as number)
				.count(),
		).toBe(3);
		const loaded = user.getRelation("posts") as Collection<Post>;
		expect(loaded.count()).toBe(3);
	});

	test("has auto-detects the relation from the related class", async () => {
		const user = await User.factory()
			.define({ name: "Auto Has", email: "auto-has@x.com" })
			.has(Post.factory().define({ title: "Auto Post" }), undefined, 2)
			.createOne();
		expect(
			await Post.query()
				.where("userId", user.get("id") as number)
				.count(),
		).toBe(2);
	});

	test("has attaches child rows to a nested parent created by for()", async () => {
		const user = await User.create({ name: "Nested", email: "nested@x.com" });
		const post = await Post.factory()
			.define({ title: "Nested Post" })
			.for(user)
			.has(
				Comment.factory().define({ body: (index) => `c${index}` }),
				"comments",
				2,
			)
			.createOne();

		expect(post.get("userId")).toBe(user.get("id"));
		expect(
			await Comment.query()
				.where("postId", post.get("id") as number)
				.count(),
		).toBe(2);
	});

	test("hasAttached creates related rows and pivot entries", async () => {
		const user = await User.create({ name: "Tagger", email: "tagger@x.com" });
		const post = await Post.factory()
			.define({ title: "Tagged Post" })
			.for(user)
			.hasAttached(
				Tag.factory().define({ name: (index) => `tag-${index}` }),
				"tags",
				2,
			)
			.createOne();

		const postId = post.get("id");
		expect(
			await orm
				.table("post_tag")
				.where("postId", postId as number)
				.count(),
		).toBe(2);
		const loaded = post.getRelation("tags") as Collection<Tag>;
		expect(loaded.count()).toBe(2);
	});
});

describe("factory parity — hooks, quiet create and configuration", () => {
	test("afterMaking and afterCreating run in order with the right state", async () => {
		const events: Array<[string, unknown]> = [];
		const factory = User.factory()
			.define({ name: "Hooked", email: "hooked@x.com" })
			.afterMaking((model) => {
				events.push(["making", model.get("id")]);
			})
			.afterCreating((model) => {
				events.push(["creating", model.get("id")]);
			})
			.after(() => {
				events.push(["after", undefined]);
			});

		factory.makeOne();
		expect(events).toEqual([
			["making", undefined],
			["after", undefined],
		]);

		events.length = 0;
		const created = await factory.createOne();
		expect(events.map((event) => event[0])).toEqual([
			"making",
			"creating",
			"after",
		]);
		expect(events[1]?.[1]).toBe(created.get("id"));
	});

	test("createQuietly and storeQuietly suppress model events", async () => {
		let created = 0;
		const off = User.on("created", () => {
			created += 1;
		});

		try {
			await User.factory()
				.define({ name: "Quiet", email: (index) => `quiet${index}@x.com` })
				.count(2)
				.createQuietly();
			expect(created).toBe(0);

			await User.factory()
				.define({ name: "Stored", email: (index) => `stored${index}@x.com` })
				.count(2)
				.storeQuietly();
			expect(created).toBe(0);

			await User.factory()
				.define({ name: "Loud", email: (index) => `loud${index}@x.com` })
				.count(2)
				.create();
			expect(created).toBe(2);
		} finally {
			off();
		}
	});

	test("configure runs the configurator against the factory", () => {
		const user = User.factory()
			.configure((factory) =>
				factory
					.define({ name: "Configured", email: "configured@x.com" })
					.state({
						role: "admin",
					}),
			)
			.makeOne();
		expect(user.get("name")).toBe("Configured");
		expect(user.get("role")).toBe("admin");
	});

	test("factory instances are Factory values", () => {
		expect(User.factory()).toBeInstanceOf(Factory);
	});
});
