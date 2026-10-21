// Polymorphic relations — the complete `morphTo` surface.
//
// Covers nested paths below a polymorphic relation, per-type constraints,
// the `whereHasMorph` family, aggregates over a polymorphic relation and
// eager loading through it.

import { beforeAll, describe, expect, test } from "bun:test";
import {
	belongsTo,
	defineSchema,
	hasMany,
	InvalidQueryError,
	morphMany,
	morphTo,
	Orm,
} from "../../src/index";
import { sqlite } from "../../src/sqlite";

const schema = defineSchema({
	users: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		name: "string",
		email: "string",
	},
	posts: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
	},
	videos: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		userId: "integer",
		title: "string",
		views: { type: "integer", default: 0 },
	},
	comments: {
		id: { type: "integer", primaryKey: true, autoIncrement: true },
		commentableId: { type: "integer", nullable: true },
		commentableType: { type: "string", nullable: true },
		body: "string",
	},
});

const orm = new Orm({
	schema,
	dialect: sqlite(":memory:"),
	encryptionKey: "morph-suite-key",
});

class User extends orm.model("users") {
	static fillable = ["name", "email"] as const;
	static relations = {
		posts: hasMany(() => Post, "userId"),
		videos: hasMany(() => Video, "userId"),
	};
}

class Post extends orm.model("posts") {
	static fillable = ["userId", "title", "views"] as const;
	static relations = {
		author: belongsTo(() => User, "userId"),
		comments: morphMany(() => Comment, "commentable"),
	};
}

class Video extends orm.model("videos") {
	static fillable = ["userId", "title", "views"] as const;
	static relations = {
		author: belongsTo(() => User, "userId"),
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

const ids = {
	ada: 0,
	grace: 0,
	post: 0,
	video: 0,
};

async function seed(): Promise<void> {
	const builder = orm.schemaBuilder();
	await builder.create("users", (t) => {
		t.id();
		t.string("name", 120);
		t.string("email", 190);
	});
	await builder.create("posts", (t) => {
		t.id();
		t.integer("userId");
		t.string("title", 200);
		t.integer("views").default(0);
	});
	await builder.create("videos", (t) => {
		t.id();
		t.integer("userId");
		t.string("title", 200);
		t.integer("views").default(0);
	});
	await builder.create("comments", (t) => {
		t.id();
		t.integer("commentableId").nullable();
		t.string("commentableType", 60).nullable();
		t.string("body", 200);
	});

	const ada = await User.create({ name: "Ada", email: "ada@example.com" });
	const grace = await User.create({
		name: "Grace",
		email: "grace@example.com",
	});
	ids.ada = ada.get("id") as number;
	ids.grace = grace.get("id") as number;

	const post = await Post.create({
		userId: ids.ada,
		title: "Analytical engine",
		views: 10,
	});
	const video = await Video.create({
		userId: ids.ada,
		title: "Lecture",
		views: 5,
	});
	ids.post = post.get("id") as number;
	ids.video = video.get("id") as number;

	await Post.create({
		userId: ids.grace,
		title: "Compilers",
		views: 20,
	});

	await Comment.create({
		commentableId: ids.post,
		commentableType: "posts",
		body: "on the post",
	});
	await Comment.create({
		commentableId: ids.video,
		commentableType: "videos",
		body: "on the video",
	});
	await Comment.create({
		commentableId: 999_999,
		commentableType: "posts",
		body: "dangling",
	});
	await Comment.create({
		commentableId: null,
		commentableType: null,
		body: "orphan",
	});
}

beforeAll(async () => {
	await seed();
});

describe("polymorphic relations", () => {
	test("whereHas walks nested paths below a polymorphic relation", async () => {
		const rows = await Comment.query()
			.whereHas("commentable.author", (group) => group.where("name", "Ada"))
			.orderBy("id")
			.get();
		expect(rows.map((row) => row.get("body")).all()).toEqual([
			"on the post",
			"on the video",
		]);

		const grace = await Comment.query()
			.whereHas("commentable.author", (group) => group.where("name", "Grace"))
			.get();
		expect(grace).toHaveLength(0);
	});

	test("whereHas below a polymorphic relation reports unknown paths", () => {
		expect(() => Comment.query().whereHas("commentable.nope" as never)).toThrow(
			InvalidQueryError,
		);
	});

	test("whereHasMorph accepts a constraint per morph type", async () => {
		const rows = await Comment.query()
			.whereHasMorph("commentable", {
				posts: (query) => query.where("views", ">", 5),
				videos: (query) => query.where("views", ">", 4),
			})
			.orderBy("id")
			.get();
		expect(rows.map((row) => row.get("body")).all()).toEqual([
			"on the post",
			"on the video",
		]);

		const onlyVideos = await Comment.query()
			.whereHasMorph("commentable", {
				videos: (query) => query.where("views", ">", 100),
			})
			.get();
		expect(onlyVideos).toHaveLength(0);
	});

	test("whereHasMorph keeps the single-constraint form", async () => {
		const rows = await Comment.query()
			.whereHasMorph("commentable", "posts", (query) =>
				query.where("views", ">", 5),
			)
			.get();
		expect(rows.map((row) => row.get("body")).all()).toEqual(["on the post"]);

		const everyType = await Comment.query()
			.whereHasMorph("commentable", "*", (query) =>
				query.where("views", ">", 4),
			)
			.orderBy("id")
			.get();
		expect(everyType.map((row) => row.get("body")).all()).toEqual([
			"on the post",
			"on the video",
		]);
	});

	test("whereDoesntHaveMorph keeps rows without a matching target", async () => {
		const rows = await Comment.query()
			.whereDoesntHaveMorph("commentable", "*")
			.orderBy("id")
			.get();
		expect(rows.map((row) => row.get("body")).all()).toEqual([
			"dangling",
			"orphan",
		]);
	});

	test("orWhereHasMorph combines with the previous condition", async () => {
		const rows = await Comment.query()
			.where("body", "on the post")
			.orWhereHasMorph("commentable", {
				videos: (query) => query.where("views", ">", 4),
			})
			.orderBy("id")
			.get();
		expect(rows.map((row) => row.get("body")).all()).toEqual([
			"on the post",
			"on the video",
		]);
	});

	test("withCount counts the polymorphic target", async () => {
		const rows = await Comment.query()
			.withCount("commentable")
			.orderBy("id")
			.get();
		const counts = rows.map(
			(row) =>
				(row as unknown as { commentableCount: number }).commentableCount,
		);
		expect(counts.all()).toEqual([1, 1, 0, 0]);
	});

	test("withSum aggregates the polymorphic target column", async () => {
		const rows = await Comment.query()
			.withSum("commentable", "views")
			.orderBy("id")
			.get();
		const sums = rows.map(
			(row) =>
				(row as unknown as { commentableSumViews: number | null })
					.commentableSumViews,
		);
		expect(sums.all()).toEqual([10, 5, null, null]);
	});

	test("withExists reports whether the polymorphic target exists", async () => {
		const rows = await Comment.query()
			.withExists("commentable")
			.orderBy("id")
			.get();
		const flags = rows.map(
			(row) =>
				(row as unknown as { commentableExists: boolean }).commentableExists,
		);
		expect(flags.all()).toEqual([true, true, false, false]);
	});

	test("eager loading walks nested paths below a polymorphic relation", async () => {
		const [row] = await Comment.query()
			.where("body", "on the post")
			.with("commentable.author")
			.get();
		const commentable = row?.commentable as unknown as {
			author?: { get(name: string): unknown };
		};
		expect(commentable?.author?.get("name")).toBe("Ada");
	});

	test("eager loading accepts a constraint per morph type", async () => {
		const rows = await Comment.query()
			.with({
				commentable: (query) => query.where("id", ">", 1_000_000),
			})
			.orderBy("id")
			.get();
		// The constraint does not match any target, so no comment gets one.
		expect(rows[0]?.commentable).toBeNull();
	});

	test("withMorph constrains every morph type on its own", async () => {
		const rows = await Comment.query()
			.withMorph("commentable", {
				posts: (query) => query.where("views", ">", 5),
				videos: (query) => query.where("views", ">", 100),
			})
			.orderBy("id")
			.get();
		expect(rows[0]?.commentable).not.toBeNull();
		expect(rows[1]?.commentable).toBeNull();

		expect(() =>
			Comment.query().withMorph("commentable", {
				unknown: (query: unknown) => query,
			} as never),
		).toThrow(InvalidQueryError);
	});

	test("loadCount works on a polymorphic relation", async () => {
		const comment = await Comment.query()
			.where("body", "on the post")
			.firstOrFail();
		await comment.loadCount("commentable");
		expect(
			(comment as unknown as { commentableCount: number }).commentableCount,
		).toBe(1);
	});

	test("deep relation paths load through a polymorphic relation", async () => {
		const [row] = await Comment.query()
			.where("body", "on the post")
			.with("commentable.author.posts.comments.commentable.author")
			.get();
		const commentable = row?.commentable as unknown as {
			author?: {
				posts?: Array<{ comments?: Array<{ commentable?: unknown }> }>;
			};
		};
		const author = commentable?.author;
		expect(author?.posts?.length).toBeGreaterThan(0);
		const nested = author?.posts?.[0]?.comments?.[0]?.commentable;
		expect(nested).not.toBeNull();
	});
});
