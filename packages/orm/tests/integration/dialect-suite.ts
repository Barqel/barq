// Shared integration suite for the server dialects (MySQL / PostgreSQL).
//
// The exact same test body runs against either engine. SQLite is covered by
// `sqlite.test.ts` on every `bun test`; MySQL and PostgreSQL run this suite
// when `BARQ_ORM_MYSQL_URL` / `BARQ_ORM_PG_URL` point at a live server. Until
// then those dialects are documented as "SQL generation tested, live tests
// pending" — never claimed as verified.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Dialect } from "kysely";
import {
	belongsTo,
	belongsToMany,
	defineSchema,
	hasMany,
	hasManyThrough,
	hasOne,
	latestOfMany,
	Migrator,
	morphedByMany,
	morphMany,
	morphTo,
	morphToMany,
	Orm,
	UniqueConstraintError,
	withDefault,
} from "../../src/index";

export function runDialectSuite(
	label: string,
	makeDialect: () => Dialect,
	options: { placeholder: (position: number) => string },
): void {
	describe(label, () => {
		const schema = defineSchema({
			users: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				name: "string",
				email: "string",
				age: { type: "integer", nullable: true },
				active: { type: "boolean", default: true },
				settings: { type: "json", nullable: true },
				balance: { type: "decimal", nullable: true },
				countryId: { type: "integer", nullable: true },
				deletedAt: { type: "datetime", nullable: true },
				createdAt: { type: "datetime", nullable: true },
				updatedAt: { type: "datetime", nullable: true },
			},
			bigRecords: {
				id: {
					type: "bigint",
					primaryKey: true,
					autoIncrement: true,
					bigInt: true,
				},
				value: { type: "bigint", bigInt: true },
			},
			bigScores: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				bigRecordId: { type: "bigint", bigInt: true },
				amount: { type: "bigint", bigInt: true },
			},
			posts: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				userId: "integer",
				title: "string",
				views: { type: "integer", default: 0 },
				deletedAt: { type: "datetime", nullable: true },
			},
			profiles: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				userId: "integer",
				bio: { type: "text", nullable: true },
			},
			countries: {
				id: { type: "integer", primaryKey: true, autoIncrement: true },
				name: "string",
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
		});

		const orm = new Orm({ schema, dialect: makeDialect() });

		class Country extends orm.model("countries") {
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
			static relations = {
				posts: hasMany(() => Post, "userId"),
				profile: hasOne(() => Profile, "userId"),
				country: belongsTo(() => Country, "countryId"),
				latestPost: latestOfMany(() => Post, "userId", "views"),
				roles: belongsToMany(() => Role, {
					through: "role_user",
					foreignPivotKey: "userId",
					relatedPivotKey: "roleId",
					withPivot: ["note"],
					timestamps: true,
					as: "membership",
				}),
				tags: morphToMany(() => Tag, "taggable", {
					through: "taggables",
					foreignPivotKey: "taggableId",
					relatedPivotKey: "tagId",
				}),
			};
			static casts = { active: "boolean", settings: "json" } as const;
			static fillable = [
				"name",
				"email",
				"age",
				"active",
				"settings",
				"countryId",
			] as const;
			static hidden = ["email"] as const;
		}

		class Post extends orm.model("posts") {
			static softDeletes = true;
			static relations = {
				author: belongsTo(() => User, "userId"),
				authorOrDefault: withDefault(
					belongsTo(() => User, "userId"),
					{
						name: "Guest",
						email: "guest@example.com",
					},
				),
				comments: morphMany(() => Comment, "commentable"),
				tags: morphToMany(() => Tag, "taggable", {
					through: "taggables",
					foreignPivotKey: "taggableId",
					relatedPivotKey: "tagId",
				}),
			};
		}

		class Profile extends orm.model("profiles") {}

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

		class Tag extends orm.model("tags") {
			static relations = {
				posts: morphedByMany(() => Post, "taggable", {
					through: "taggables",
					foreignPivotKey: "tagId",
					relatedPivotKey: "taggableId",
				}),
			};
		}

		class Role extends orm.model("roles") {}

		/** Same table as Post, but its polymorphic rows store "article". */
		class RenamedPost extends orm.model("posts") {
			static morphAlias = "article";
			static relations = {
				tags: morphToMany(() => Tag, "taggable", {
					through: "taggables",
					foreignPivotKey: "taggableId",
					relatedPivotKey: "tagId",
				}),
			};
		}

		class BigRecord extends orm.model("bigRecords") {
			static fillable = ["value"] as const;
			static relations = {
				scores: hasMany(() => BigScore, "bigRecordId"),
			};
		}

		class BigScore extends orm.model("bigScores") {
			static fillable = ["bigRecordId", "amount"] as const;
		}

		/** Dedicated class so listeners/accessors never leak into other tests. */
		class AuditedUser extends orm.model("users") {
			static fillable = ["name", "email", "age", "settings"] as const;
			static casts = { settings: "json" } as const;
			static accessors = {
				displayName: (user: AuditedUser) =>
					`${user.get("name")} <${user.get("email")}>`,
			};
			static appends = ["displayName"] as const;
		}

		beforeAll(async () => {
			const ddl = orm.schemaBuilder();
			await ddl.dropIfExists("taggables");
			await ddl.dropIfExists("role_user");
			await ddl.dropIfExists("roles");
			await ddl.dropIfExists("bigScores");
			await ddl.dropIfExists("bigRecords");
			await ddl.dropIfExists("tags");
			await ddl.dropIfExists("comments");
			await ddl.dropIfExists("videos");
			await ddl.dropIfExists("posts");
			await ddl.dropIfExists("profiles");
			await ddl.dropIfExists("countries");
			await ddl.dropIfExists("users");
			await ddl.create("countries", (t) => {
				t.id();
				t.string("name", 120);
			});
			await ddl.create("bigRecords", (t) => {
				t.id();
				t.bigint("value");
			});
			await ddl.create("bigScores", (t) => {
				t.id();
				t.bigint("bigRecordId");
				t.bigint("amount");
			});
			await ddl.create("users", (t) => {
				t.id();
				t.string("name", 120);
				t.string("email", 190).unique();
				t.integer("age").nullable();
				t.boolean("active").default(true);
				t.json("settings").nullable();
				t.decimal("balance", 12, 2).nullable();
				t.integer("countryId").nullable();
				t.datetime("deletedAt").nullable();
				t.datetime("createdAt").nullable();
				t.datetime("updatedAt").nullable();
			});
			await ddl.create("posts", (t) => {
				t.id();
				t.integer("userId");
				t.string("title", 190);
				t.integer("views").default(0);
				t.datetime("deletedAt").nullable();
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
				t.string("taggableType", 60);
				t.integer("tagId");
			});
			await ddl.create("roles", (t) => {
				t.id();
				t.string("name", 60);
			});
			await ddl.create("role_user", (t) => {
				t.integer("userId");
				t.integer("roleId");
				t.string("note", 200).nullable();
				t.datetime("createdAt").nullable();
				t.datetime("updatedAt").nullable();
			});
		});

		afterAll(async () => {
			await orm.destroy();
		});

		test("row path: insert returns the generated id, select round-trips", async () => {
			const inserted = await orm
				.table("users")
				.insert({ name: "Ada", email: "ada@example.com", age: 36 });
			expect(typeof inserted.id).toBe("number");
			const row = await orm
				.table("users")
				.where("email", "ada@example.com")
				.firstOrFail();
			expect(row.name).toBe("Ada");
			expect(row.active).toBe(true);
			expect(row.balance).toBeNull();
		});

		test("bigint columns preserve 64-bit precision", async () => {
			const maximum = 9223372036854775807n;
			const inserted = await orm.table("bigRecords").insert({ value: maximum });
			expect(inserted.id).toBe(1n);

			const row = await orm.table("bigRecords").firstOrFail();
			expect(row.id).toBe(1n);
			expect(row.value).toBe(maximum);

			const filtered = await orm
				.table("bigRecords")
				.where("value", "=", maximum)
				.firstOrFail();
			expect(filtered.id).toBe(1n);
			expect(await orm.table("bigRecords").max("value")).toBe(maximum);

			await orm.table("bigScores").insertMany([
				{ bigRecordId: 1n, amount: 9007199254740993n },
				{ bigRecordId: 1n, amount: 2n },
			]);
			const aggregate = await BigRecord.query()
				.withSum("scores", "amount")
				.withMin("scores", "amount")
				.withMax("scores", "amount")
				.withAvg("scores", "amount")
				.where("id", 1n)
				.firstOrFail();
			expect(aggregate.scoresSumAmount).toBe(9007199254740995n);
			expect(aggregate.scoresMinAmount).toBe(2n);
			expect(aggregate.scoresMaxAmount).toBe(9007199254740993n);
			expect(typeof aggregate.scoresAvgAmount).toBe("number");

			const loaded = await BigRecord.query()
				.with("scores")
				.where("id", 1n)
				.firstOrFail();
			expect(loaded.scores).toHaveLength(2);
			expect(
				loaded.scores.every((score) => score.get("bigRecordId") === 1n),
			).toBe(true);
			const filteredByRelation = await BigRecord.query()
				.whereHas("scores")
				.where("id", 1n)
				.firstOrFail();
			expect(filteredByRelation.get("id")).toBe(1n);

			const model = await BigRecord.create({ value: maximum - 1n });
			expect(model.get("id")).toBe(2n);
			expect(model.get("value")).toBe(maximum - 1n);
			const found = await BigRecord.find(2n);
			expect(found?.get("value")).toBe(maximum - 1n);

			if (orm.dialectKind === "mysql") {
				// mysql2 returns insert ids as strings when they exceed the safe
				// integer range; both write paths must preserve every bit.
				await orm.raw(
					"alter table `bigRecords` auto_increment = 9007199254740993",
				);
				const huge = await orm.table("bigRecords").insert({ value: 7n });
				expect(huge.id).toBe(9007199254740993n);

				const modelHuge = await BigRecord.create({ value: 8n });
				expect(modelHuge.get("id")).toBe(9007199254740994n);

				// Multi-row inserts shift the first id by each row offset.
				const manyHuge = await BigRecord.createMany([
					{ value: 9n },
					{ value: 10n },
				]);
				expect(manyHuge[0]?.get("id")).toBe(9007199254740995n);
				expect(manyHuge[1]?.get("id")).toBe(9007199254740996n);
			}
		});

		test("row path: filters, ordering, pagination and aggregates", async () => {
			await orm.table("users").insertMany([
				{ name: "Grace", email: "grace@example.com", age: 45 },
				{ name: "Alan", email: "alan@example.com", age: 41 },
				{ name: "Linus", email: "linus@example.com", age: 55 },
			]);
			const adults = await orm
				.table("users")
				.where("age", ">", 40)
				.orderBy("age", "desc")
				.limit(2)
				.get();
			expect(adults.map((user) => user.name).all()).toEqual(["Linus", "Grace"]);
			const count = await orm.table("users").where("age", ">", 40).count();
			expect(count).toBe(3);
			const page = await orm.table("users").orderBy("id").paginate(2, 2);
			expect(page.perPage).toBe(2);
			expect(page.data).toHaveLength(2);
			expect(page.total).toBe(4);
		});

		test("update and delete report affected rows", async () => {
			const updated = await orm
				.table("users")
				.where("email", "alan@example.com")
				.update({ age: 42 });
			expect(updated).toBe(1);
			const removed = await orm
				.table("users")
				.where("email", "linus@example.com")
				.delete();
			expect(removed).toBe(1);
		});

		test("upsert inserts, then updates on conflict", async () => {
			await orm
				.table("users")
				.upsert(
					{ name: "Original", email: "upsert@example.com" },
					{ conflictOn: "email", update: ["name"] },
				);
			await orm
				.table("users")
				.upsert(
					{ name: "Replaced", email: "upsert@example.com" },
					{ conflictOn: "email", update: ["name"] },
				);
			const row = await orm
				.table("users")
				.where("email", "upsert@example.com")
				.firstOrFail();
			expect(row.name).toBe("Replaced");
		});

		test("model path: create, casts, dirty tracking, save, refresh", async () => {
			const user = await User.create({
				name: "Model",
				email: "model@example.com",
				age: 20,
				settings: { theme: "dark" },
			});
			expect(user.get("id")).toBeDefined();
			expect(user.get("settings")).toEqual({ theme: "dark" });
			expect(user.isDirty()).toBe(false);
			user.set("age", 21);
			expect(user.getDirty()).toEqual({ age: 21 });
			await user.save();
			expect(user.isDirty()).toBe(false);
			const reloaded = await User.find(user.get("id") as number);
			expect(reloaded?.get("age")).toBe(21);
			expect(reloaded?.get("createdAt")).toBeInstanceOf(Date);
			await reloaded?.delete();
			expect(await User.find(user.get("id") as number)).toBeNull();
		});

		test("model path: fillable allow-list and hidden columns", async () => {
			const user = await User.create({
				name: "Hidden",
				email: "hidden@example.com",
			});
			const json = user.toJSON() as Record<string, unknown>;
			expect(json.email).toBeUndefined();
			expect(json.name).toBe("Hidden");
			await expect(
				User.create({
					name: "X",
					email: "x@example.com",
					role: "root",
				} as never),
			).rejects.toThrow();
		});

		test("relations: batched eager loading without N+1", async () => {
			const ada = await User.create({
				name: "Eager",
				email: "eager@example.com",
			});
			const id = ada.get("id") as number;
			await Post.create({ userId: id, title: "First", views: 10 });
			await Post.create({ userId: id, title: "Second", views: 5 });
			await Profile.create({ userId: id, bio: "hello" });

			const selects: string[] = [];
			const off = orm.onQuery((event) => {
				if (event.sql.trim().toLowerCase().startsWith("select")) {
					selects.push(event.sql);
				}
			});
			const loaded = await User.query()
				.with("posts", "posts.author", "profile")
				.where("id", id)
				.firstOrFail();
			off();

			expect(
				loaded.posts
					.map((post) => post.get("title"))
					.sort()
					.all(),
			).toEqual(["First", "Second"]);
			expect(
				loaded.posts.every((post) => post.author?.get("name") === "Eager"),
			).toBe(true);
			expect(loaded.profile?.get("bio")).toBe("hello");
			// users + posts + posts.author + profile — never one query per row
			expect(selects).toHaveLength(4);
		});

		test("transactions: commit, rollback and savepoints", async () => {
			await orm.transaction(async (tx) => {
				await tx
					.table("users")
					.insert({ name: "Committed", email: "committed@example.com" });
			});
			expect(
				await orm
					.table("users")
					.where("email", "committed@example.com")
					.count(),
			).toBe(1);

			await expect(
				orm.transaction(async (tx) => {
					await tx
						.table("users")
						.insert({ name: "Rolled back", email: "rolled-back@example.com" });
					throw new Error("boom");
				}),
			).rejects.toThrow("boom");
			expect(
				await orm
					.table("users")
					.where("email", "rolled-back@example.com")
					.count(),
			).toBe(0);

			await orm.transaction(async (tx) => {
				await tx
					.table("users")
					.insert({ name: "Outer", email: "sp-outer@example.com" });
				// Nested calls become savepoints on the ambient transaction.
				await orm
					.transaction(async () => {
						await orm
							.table("users")
							.insert({ name: "Inner", email: "sp-inner@example.com" });
						throw new Error("inner");
					})
					.catch(() => undefined);
			});
			expect(
				await orm.table("users").where("email", "sp-outer@example.com").count(),
			).toBe(1);
			expect(
				await orm.table("users").where("email", "sp-inner@example.com").count(),
			).toBe(0);
		});

		test("migrations: migrate books one batch, rollback reverses it", async () => {
			const migrator = new Migrator(orm, {
				table: "barq_dialect_migrations",
				migrations: [
					{
						name: "001_create_widgets",
						async up({ schema: ddl }) {
							await ddl.create("widgets", (t) => {
								t.id();
								t.string("label", 60);
							});
						},
						async down({ schema: ddl }) {
							await ddl.dropIfExists("widgets");
						},
					},
				],
			});
			const applied = await migrator.migrate();
			expect(applied.applied).toEqual(["001_create_widgets"]);
			expect(await orm.schemaBuilder().hasTable("widgets")).toBe(true);
			const rolledBack = await migrator.rollback();
			expect(rolledBack).toEqual(["001_create_widgets"]);
			expect(await orm.schemaBuilder().hasTable("widgets")).toBe(false);
		});

		test("unique violations are translated to UniqueConstraintError", async () => {
			await orm
				.table("users")
				.insert({ name: "Solo", email: "solo@example.com" });
			await expect(
				orm.table("users").insert({ name: "Clone", email: "solo@example.com" }),
			).rejects.toThrow(UniqueConstraintError);
		});

		test("raw SQL with bindings round-trips", async () => {
			const result = await orm.raw(
				`select count(*) as total from users where age >= ${options.placeholder(1)}`,
				[40],
			);
			expect(
				Number((result.rows[0] as { total: unknown }).total),
			).toBeGreaterThan(0);
		});

		// -------------------------------------------------------------------
		// Eloquent parity — the same behaviors SQLite asserts in detail.
		// -------------------------------------------------------------------

		test("increment/decrement and firstOrCreate/updateOrCreate", async () => {
			const created = await User.firstOrCreate(
				{ email: "parity-first@example.com" },
				{ name: "Parity", age: 10 },
			);
			const existing = await User.firstOrCreate(
				{ email: "parity-first@example.com" },
				{ name: "Ignored", age: 99 },
			);
			expect(existing.get("id")).toBe(created.get("id"));
			expect(existing.get("name")).toBe("Parity");

			const updated = await User.updateOrCreate(
				{ email: "parity-first@example.com" },
				{ age: 12 },
			);
			expect(updated.get("age")).toBe(12);

			const id = created.get("id") as number;
			expect(await orm.table("users").where("id", id).increment("age", 3)).toBe(
				1,
			);
			expect((await orm.table("users").where("id", id).firstOrFail()).age).toBe(
				15,
			);
			expect(await orm.table("users").where("id", id).decrement("age", 5)).toBe(
				1,
			);
			expect((await orm.table("users").where("id", id).firstOrFail()).age).toBe(
				10,
			);

			const user = await User.findOrFail(id);
			const originalName = user.getOriginal("name");
			user.set("name", "Renamed");
			expect(user.getOriginal("name")).toBe(originalName);
			expect(user.getDirty()).toEqual({ name: "Renamed" });
			await user.save();
			expect((await User.findOrFail(id)).get("name")).toBe("Renamed");
		});

		test("aggregates and constrained eager loading", async () => {
			const owner = await User.create({
				name: "Aggregates",
				email: "aggregates@example.com",
			});
			const id = owner.get("id") as number;
			await Post.createMany([
				{ userId: id, title: "Low", views: 2 },
				{ userId: id, title: "Mid", views: 3 },
				{ userId: id, title: "High", views: 5 },
			]);

			const row = await User.query()
				.withSum("posts", "views")
				.withAvg("posts", "views")
				.withMin("posts", "views")
				.withMax("posts", "views")
				.withCount("posts as postCount")
				.where("id", id)
				.firstOrFail();
			expect(row.postsSumViews).toBe(10);
			expect(row.postsAvgViews).toBeCloseTo(10 / 3);
			expect(row.postsMinViews).toBe(2);
			expect(row.postsMaxViews).toBe(5);
			expect(row.postCount).toBe(3);

			const owned = Post.query().where("userId", id);
			expect(await owned.clone().sum("views")).toBe(10);
			expect(await owned.clone().avg("views")).toBeCloseTo(10 / 3);
			expect(await owned.clone().min("views")).toBe(2);
			expect(await owned.clone().max("views")).toBe(5);

			const constrained = await User.query()
				.with({
					posts: (query) =>
						query.where("views", ">=", 3).orderBy("views", "desc"),
				})
				.where("id", id)
				.firstOrFail();
			expect(constrained.posts.map((post) => post.get("title")).all()).toEqual([
				"High",
				"Mid",
			]);
			expect(
				await User.query().whereDoesntHave("posts").where("id", id).count(),
			).toBe(0);
		});

		test("events, observers and accessors", async () => {
			const seen: string[] = [];
			const offCreating = AuditedUser.on("creating", () => {
				seen.push("creating");
			});
			const offObserver = AuditedUser.observe({
				created: () => {
					seen.push("created");
				},
				updated: () => {
					seen.push("updated");
				},
			});
			try {
				const user = await AuditedUser.create({
					name: "Evented",
					email: "evented@example.com",
					age: 1,
					settings: { theme: "dark" },
				});
				expect(seen).toEqual(["creating", "created"]);
				expect(user.displayName).toBe("Evented <evented@example.com>");
				expect((user.toJSON() as Record<string, unknown>).displayName).toBe(
					"Evented <evented@example.com>",
				);
				expect(user.get("settings")).toEqual({ theme: "dark" });

				user.set("age", 2);
				await user.save();
				expect(seen).toContain("updated");
			} finally {
				offCreating();
				offObserver();
			}
		});

		test("soft deletes: scopes, restore and force delete", async () => {
			const owner = await User.create({
				name: "Soft",
				email: "soft@example.com",
			});
			const post = await Post.create({
				userId: owner.get("id") as number,
				title: "Disposable",
			});
			const id = post.get("id") as number;

			expect(await post.delete()).toBe(true);
			expect(post.trashed()).toBe(true);
			expect(await Post.find(id)).toBeNull();
			expect(
				(await Post.withTrashed().where("id", id).firstOrFail()).trashed(),
			).toBe(true);
			expect(await Post.onlyTrashed().where("id", id).count()).toBe(1);

			expect(await Post.withTrashed().where("id", id).restore()).toBe(1);
			expect((await Post.find(id))?.trashed()).toBe(false);
			expect(await Post.query().where("id", id).forceDelete()).toBe(1);
			expect(await Post.withTrashed().where("id", id).count()).toBe(0);
		});

		test("hasManyThrough batches and filters across the pivot", async () => {
			const country = await orm
				.table("countries")
				.insert({ name: "Dialect Egypt" });
			const countryId = country.id as number;
			const user = await User.create({
				name: "Through",
				email: "through@example.com",
				countryId,
			});
			await Post.createMany([
				{ userId: user.get("id") as number, title: "First", views: 9 },
				{ userId: user.get("id") as number, title: "Second", views: 1 },
			]);

			const loaded = await Country.query()
				.with("posts")
				.withCount("posts")
				.where("id", countryId)
				.firstOrFail();
			expect(
				loaded.posts
					.map((post) => post.get("title"))
					.sort()
					.all(),
			).toEqual(["First", "Second"]);
			expect(loaded.postsCount).toBe(2);

			const filtered = await Country.query()
				.whereHas("posts", (group) => group.where("views", ">", 5))
				.where("id", countryId)
				.get();
			expect(filtered).toHaveLength(1);
		});

		test("polymorphic relations and morph-to-many pivots", async () => {
			const user = await User.create({
				name: "Morph",
				email: "morph@example.com",
			});
			const userId = user.get("id") as number;
			const post = await Post.create({ userId, title: "Morph post" });
			const postId = post.get("id") as number;
			const video = await Video.create({ title: "Morph video" });
			const videoId = video.get("id") as number;

			await Comment.create({
				body: "post comment",
				commentableId: postId,
				commentableType: "posts",
			});
			await Comment.create({
				body: "video comment",
				commentableId: videoId,
				commentableType: "videos",
			});

			const loadedPost = await Post.query()
				.with("comments")
				.where("id", postId)
				.firstOrFail();
			expect(
				loadedPost.comments.map((comment) => comment.get("body")).all(),
			).toEqual(["post comment"]);

			const comments = await Comment.query()
				.with("commentable")
				.orderBy("id")
				.get();
			expect(
				comments
					.map((comment) =>
						comment.commentable instanceof Post
							? "post"
							: comment.commentable instanceof Video
								? "video"
								: "null",
					)
					.all(),
			).toEqual(["post", "video"]);

			const tag = await Tag.create({ name: "dialect-ts" });
			const tagId = tag.get("id") as number;
			await orm.table("taggables").insert([
				{ taggableId: postId, taggableType: "posts", tagId },
				{ taggableId: userId, taggableType: "users", tagId },
			]);

			const taggedPost = await Post.query()
				.with("tags")
				.withCount("tags")
				.where("id", postId)
				.firstOrFail();
			expect(taggedPost.tags.map((item) => item.get("name")).all()).toEqual([
				"dialect-ts",
			]);
			expect(taggedPost.tagsCount).toBe(1);

			const taggedUser = await User.query()
				.with("tags")
				.where("id", userId)
				.firstOrFail();
			expect(taggedUser.tags.map((item) => item.get("name")).all()).toEqual([
				"dialect-ts",
			]);
		});

		test("pivot parity: named accessor, extra columns, timestamps and constraints", async () => {
			const user = await User.create({
				name: "Pivot",
				email: "pivot@example.com",
			});
			const userId = user.get("id") as number;
			const admin = await Role.create({ name: "dialect-admin" });
			const editor = await Role.create({ name: "dialect-editor" });
			const adminId = admin.get("id") as number;
			const editorId = editor.get("id") as number;

			expect(
				await user.relation("roles").attach(adminId, { note: "primary" }),
			).toBe(1);
			expect(
				await user.relation("roles").attach(editorId, { note: "side" }),
			).toBe(1);

			const pivotRows = await orm
				.table("role_user")
				.where("userId", userId)
				.orderBy("roleId")
				.get();
			expect(pivotRows.map((row) => row.note).all()).toEqual([
				"primary",
				"side",
			]);
			expect(pivotRows[0]?.createdAt).not.toBeNull();
			expect(pivotRows[0]?.updatedAt).not.toBeNull();

			const loaded = await User.query()
				.with("roles")
				.where("id", userId)
				.firstOrFail();
			const memberships = loaded.roles.map((role) => role.membership).all();
			expect(memberships.map((membership) => membership?.note).sort()).toEqual([
				"primary",
				"side",
			]);
			expect(memberships[0]?.createdAt).toBeDefined();
			const firstRole = loaded.roles.first() as object;
			expect(Object.hasOwn(firstRole, "membership")).toBe(true);
			expect(Object.hasOwn(firstRole, "pivot")).toBe(false);

			const primaryOnly = await user
				.relation("roles")
				.wherePivot("note", "primary")
				.query()
				.get();
			expect(primaryOnly.map((role) => role.get("name")).all()).toEqual([
				"dialect-admin",
			]);
			const sideOnly = await user
				.relation("roles")
				.wherePivotIn("note", ["side"])
				.query()
				.get();
			expect(sideOnly.map((role) => role.get("name")).all()).toEqual([
				"dialect-editor",
			]);
			const ordered = await user
				.relation("roles")
				.orderByPivot("note", "desc")
				.query()
				.get();
			expect(ordered.map((role) => role.get("name")).all()).toEqual([
				"dialect-editor",
				"dialect-admin",
			]);

			// `updatedAt` refreshes on updateExistingPivot; DATETIME columns may
			// truncate to seconds, so wait out one tick before comparing.
			await Bun.sleep(1100);
			expect(
				await user
					.relation("roles")
					.updateExistingPivot(editorId, { note: "side+" }),
			).toBe(1);
			const updatedRows = await orm
				.table("role_user")
				.where("userId", userId)
				.where("roleId", editorId)
				.get();
			expect(updatedRows[0]?.note).toBe("side+");
			expect(
				new Date(String(updatedRows[0]?.updatedAt)).getTime(),
			).toBeGreaterThan(new Date(String(pivotRows[1]?.updatedAt)).getTime());
		});

		test("one-of-many extremes and default owners round-trip", async () => {
			const user = await User.create({
				name: "Extreme",
				email: "extreme@example.com",
			});
			const userId = user.get("id") as number;
			await Post.createMany([
				{ userId, title: "Low", views: 1 },
				{ userId, title: "High", views: 50 },
				{ userId, title: "Mid", views: 20 },
			]);

			const loaded = await User.query()
				.with("latestPost")
				.where("id", userId)
				.firstOrFail();
			expect(loaded.latestPost?.get("title")).toBe("High");

			const scoped = await User.query()
				.whereHas("latestPost", (group) => group.where("views", ">", 30))
				.where("id", userId)
				.get();
			expect(scoped).toHaveLength(1);

			const viaManager = await user.relation("latestPost").query().first();
			expect(viaManager?.get("title")).toBe("High");

			const orphan = await Post.create({
				userId: 987_654,
				title: "Orphan",
				views: 0,
			});
			const orphanId = orphan.get("id") as number;
			const plain = await Post.query()
				.with("author")
				.where("id", orphanId)
				.firstOrFail();
			expect(plain.author).toBeNull();
			const defaulted = await Post.query()
				.with("authorOrDefault")
				.where("id", orphanId)
				.firstOrFail();
			expect(defaulted.authorOrDefault?.get("name")).toBe("Guest");
		});

		test("morphedByMany and non-table morph aliases round-trip", async () => {
			const post = await Post.create({ userId: 0, title: "Inverse" });
			const postId = post.get("id") as number;
			const tag = await Tag.create({ name: "dialect-inverse" });
			const tagId = tag.get("id") as number;
			expect(await post.relation("tags").attach(tagId)).toBe(1);

			// Inverse direction: `morphedByMany` filters by the related class's
			// alias, so the same pivot rows are visible from Tag.
			const loadedTag = await Tag.query()
				.with("posts")
				.where("id", tagId)
				.firstOrFail();
			expect(loadedTag.posts.map((item) => item.get("id")).all()).toEqual([
				postId,
			]);
			expect(loadedTag.posts.first()?.pivot.tagId).toBe(tagId);

			// A class-level alias that differs from the table name flows through
			// writes, eager loads and existence subqueries.
			const aliased = await RenamedPost.create({
				userId: 0,
				title: "Aliased",
			});
			const aliasedId = aliased.get("id") as number;
			expect(await aliased.relation("tags").attach(tagId)).toBe(1);

			const rows = await orm.table("taggables").where("tagId", tagId).get();
			expect(
				rows
					.map((row) => row.taggableType)
					.sort()
					.all(),
			).toEqual(["article", "posts"]);

			const aliasedLoaded = await RenamedPost.query()
				.with("tags")
				.where("id", aliasedId)
				.firstOrFail();
			expect(aliasedLoaded.tags.map((item) => item.get("name")).all()).toEqual([
				"dialect-inverse",
			]);
			expect(aliasedLoaded.tags.first()?.pivot.taggableType).toBe("article");

			const matched = await Tag.query().whereHas("posts").get();
			expect(matched.map((item) => item.get("id")).all()).toContain(tagId);
		});
	});
}
