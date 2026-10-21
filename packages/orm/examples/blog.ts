// A complete, runnable walkthrough of the public API on an in-memory SQLite
// database: schema, migrations, models, relations, queries, transactions.
//
// Run:  bun run examples/blog.ts

import {
	belongsTo,
	defineSchema,
	hasMany,
	Migrator,
	ModelNotFoundError,
	Orm,
} from "../src/index";
import { sqlite } from "../src/sqlite";

// ---------------------------------------------------------------------------
// 1. Schema — the single source of truth for types and DDL
// ---------------------------------------------------------------------------

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
		settings: { type: "json", nullable: true },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
		createdAt: { type: "datetime", nullable: true },
		updatedAt: { type: "datetime", nullable: true },
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		postId: "integer",
		body: "text",
	},
});

const orm = new Orm({ schema, dialect: sqlite(":memory:") });

// ---------------------------------------------------------------------------
// 2. Models — relations, casts, mass-assignment rules
// ---------------------------------------------------------------------------

class User extends orm.model("users") {
	static relations = {
		posts: hasMany(() => Post, "userId"),
	};
	static casts = { settings: "json" } as const;
	static fillable = ["name", "email", "settings"] as const;
	static hidden = ["email"] as const;
}

class Post extends orm.model("posts") {
	static relations = {
		author: belongsTo(() => User, "userId"),
		comments: hasMany(() => Comment, "postId"),
	};
	static fillable = ["userId", "title", "views"] as const;
}

class Comment extends orm.model("comments") {
	static relations = {
		post: belongsTo(() => Post, "postId"),
	};
}

// ---------------------------------------------------------------------------
// 3. Migrations — versioned, reversible, booked in one batch
// ---------------------------------------------------------------------------

async function migrate(): Promise<void> {
	const migrator = new Migrator(orm, {
		migrations: [
			{
				name: "001_create_users_and_posts",
				async up({ schema: ddl }) {
					await ddl.create("users", (t) => {
						t.id();
						t.string("name", 120);
						t.string("email", 190).unique();
						t.json("settings").nullable();
						t.timestamps();
					});
					await ddl.create("posts", (t) => {
						t.id();
						t.integer("userId").references("users.id");
						t.string("title", 190);
						t.integer("views").default(0);
						t.timestamps();
					});
				},
				async down({ schema: ddl }) {
					await ddl.drop("posts");
					await ddl.drop("users");
				},
			},
			{
				name: "002_create_comments",
				async up({ schema: ddl }) {
					await ddl.create("comments", (t) => {
						t.id();
						t.integer("postId");
						t.text("body");
					});
				},
				async down({ schema: ddl }) {
					await ddl.drop("comments");
				},
			},
		],
	});
	const result = await migrator.migrate();
	console.log(
		`migrations applied: ${result.applied.join(", ")} (batch ${result.batch})`,
	);
}

// ---------------------------------------------------------------------------
// 4. The walkthrough
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	await migrate();

	// --- seeding -----------------------------------------------------------
	const ada = await User.create({
		name: "Ada",
		email: "ada@example.com",
		settings: { theme: "dark" },
	});
	const grace = await User.create({
		name: "Grace",
		email: "grace@example.com",
	});
	const first = await Post.create({
		userId: ada.get("id"),
		title: "On loops",
		views: 42,
	});
	await Post.create({ userId: ada.get("id"), title: "On compilers", views: 7 });
	await Post.create({ userId: grace.get("id"), title: "On COBOL", views: 3 });
	await Comment.create({ postId: first.get("id"), body: "Lovely read." });

	// --- query builder: filters, ordering, pagination -----------------------
	const page = await orm
		.table("posts")
		.where("views", ">=", 3)
		.orderBy("views", "desc")
		.paginate(2, 1);
	console.log(
		`posts page 1: total=${page.total} lastPage=${page.lastPage}`,
		page.data.map((post) => post.title),
	);
	console.log(
		"count posts with views > 5:",
		await orm.table("posts").where("views", ">", 5).count(),
	);

	// --- models: dirty tracking + update ------------------------------------
	first.set("views", 50);
	console.log("dirty before save:", first.getDirty());
	await first.save();
	console.log("dirty after save:", first.isDirty());

	// --- relations: one batched query per relation, never N+1 --------------
	const users = await User.query()
		.with("posts.comments")
		.withCount("posts")
		.orderBy("id")
		.get();
	for (const user of users) {
		const titles = user.posts.map(
			(post) => `${post.get("title")} (${post.comments.length})`,
		);
		console.log(`${user.get("name")}: postsCount=${user.postsCount}`, titles);
	}

	// --- whereHas: users that wrote a post about compilers ------------------
	const compilersAuthors = await User.query()
		.whereHas("posts", (group) => group.where("title", "like", "%compilers%"))
		.get();
	console.log(
		"compiler authors:",
		compilersAuthors.map((user) => user.get("name")),
	);

	// --- toJSON hides configured columns, includes loaded relations ---------
	console.log("user JSON:", JSON.stringify(users[0]));

	// --- transactions: commit, rollback and savepoints ----------------------
	await orm
		.transaction(async (tx) => {
			await tx
				.table("posts")
				.insert({ userId: grace.get("id"), title: "Draft" });
			throw new Error("changed my mind");
		})
		.catch((error: unknown) => {
			console.log("transaction rolled back:", (error as Error).message);
		});

	await orm.transaction(async () => {
		await orm.table("posts").insert({ userId: ada.get("id"), title: "Kept" });
		await orm
			.transaction(async () => {
				await orm
					.table("posts")
					.insert({ userId: ada.get("id"), title: "Discarded" });
				throw new Error("inner failure");
			})
			.catch(() => undefined);
	});
	console.log(
		"after savepoint demo: kept=",
		await orm.table("posts").where("title", "Kept").count(),
		"discarded=",
		await orm.table("posts").where("title", "Discarded").count(),
	);

	// --- findOrFail + typed errors ------------------------------------------
	try {
		await User.findOrFail(9999);
	} catch (error) {
		console.log(
			"findOrFail(9999):",
			error instanceof ModelNotFoundError
				? "ModelNotFoundError as expected"
				: error,
		);
	}

	await orm.destroy();
	console.log("\ndone.");
}

await main();
