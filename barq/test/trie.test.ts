import { beforeEach, describe, expect, it } from "bun:test";
import { MATCH_HANDLER, SegmentTrie } from "../src/internal/trie";

describe("SegmentTrie", () => {
	let trie: SegmentTrie;

	beforeEach(() => {
		trie = new SegmentTrie();
	});

	it("should add and match static routes", () => {
		const handler = () => new Response("ok");
		trie.add("GET", "/foo", handler);
		const matched = trie.match("GET", "/foo");
		expect(matched).toBe(handler);
	});

	it("should match parameterized routes", () => {
		const handler = () => new Response("ok");
		trie.add("GET", "/user/:id", handler);
		const matched = trie.match("GET", "/user/123");
		expect(matched).not.toBeNull();
		expect(typeof matched).toBe("object");
		if (matched && typeof matched === "object" && MATCH_HANDLER in matched) {
			expect(matched[MATCH_HANDLER]).toBe(handler);
			expect(matched.id).toBe("123");
		}
	});

	it("expands optional parameters during registration and matches both variants", () => {
		const handler = () => new Response("optional");
		trie.add("GET", "/users/:id?/posts", handler);

		expect(trie.match("GET", "/users/posts")).toBe(handler);
		const withParam = trie.match("GET", "/users/42/posts");
		expect(withParam).not.toBeNull();
		if (
			withParam &&
			typeof withParam === "object" &&
			MATCH_HANDLER in withParam
		) {
			expect(withParam[MATCH_HANDLER]).toBe(handler);
			expect(withParam.id).toBe("42");
		}
	});

	it("prefers earlier optional params before later ones when names differ", () => {
		const handler = () => new Response("optional");
		trie.add("GET", "/:id?/:name?", handler);

		const singleSegment = trie.match("GET", "/users");
		expect(singleSegment).not.toBeNull();
		if (
			singleSegment &&
			typeof singleSegment === "object" &&
			MATCH_HANDLER in singleSegment
		) {
			expect(singleSegment[MATCH_HANDLER]).toBe(handler);
			expect(singleSegment.id).toBe("users");
			expect(singleSegment.name).toBeUndefined();
		}

		const twoSegments = trie.match("GET", "/users/posts");
		expect(twoSegments).not.toBeNull();
		if (
			twoSegments &&
			typeof twoSegments === "object" &&
			MATCH_HANDLER in twoSegments
		) {
			expect(twoSegments[MATCH_HANDLER]).toBe(handler);
			expect(twoSegments.id).toBe("users");
			expect(twoSegments.name).toBe("posts");
		}
	});

	it("keeps static route precedence over an optional route expansion", () => {
		const optionalHandler = () => new Response("optional");
		const staticHandler = () => new Response("static");
		trie.add("GET", "/users/:id?", optionalHandler);
		trie.add("GET", "/users/new", staticHandler);

		expect(trie.match("GET", "/users/new")).toBe(staticHandler);
		expect(trie.match("GET", "/users")).toBe(optionalHandler);
	});

	it("keeps optional route registration atomic when an expansion conflicts", () => {
		const existing = () => new Response("existing");
		const optional = () => new Response("optional");
		trie.add("GET", "/users", existing);

		expect(() => trie.add("GET", "/users/:id?", optional)).toThrow(
			"Duplicate route",
		);
		expect(trie.match("GET", "/users")).toBe(existing);
		expect(trie.match("GET", "/users/42")).toBeNull();
	});

	it("rejects malformed optional parameter syntax", () => {
		expect(() =>
			trie.add("GET", "/users/name?", () => new Response()),
		).toThrow();
		expect(() =>
			trie.add("GET", "/users/:id??", () => new Response()),
		).toThrow();
	});

	it("should match wildcard routes", () => {
		const handler = () => new Response("ok");
		trie.add("GET", "/files/*path", handler);
		const matched = trie.match("GET", "/files/foo/bar");
		expect(matched).not.toBeNull();
		expect(typeof matched).toBe("object");
		if (matched && typeof matched === "object" && MATCH_HANDLER in matched) {
			expect(matched[MATCH_HANDLER]).toBe(handler);
			expect(matched.path).toBe("foo/bar");
		}
	});

	it("should prioritize static over parameterized routes", () => {
		const staticHandler = () => new Response("static");
		const paramHandler = () => new Response("param");
		trie.add("GET", "/users/profile", staticHandler);
		trie.add("GET", "/users/:id", paramHandler);

		const matched = trie.match("GET", "/users/profile");
		expect(matched).toBe(staticHandler);
	});

	it("should prioritize parameterized over wildcard routes", () => {
		const paramHandler = () => new Response("param");
		const wildcardHandler = () => new Response("wildcard");
		trie.add("GET", "/api/:name", paramHandler);
		trie.add("GET", "/files/*", wildcardHandler);

		const matched = trie.match("GET", "/api/test");
		expect(typeof matched).toBe("object");
		if (matched && typeof matched === "object" && MATCH_HANDLER in matched) {
			expect(matched[MATCH_HANDLER]).toBe(paramHandler);
		}
	});

	it("should return null for non-matching routes", () => {
		trie.add("GET", "/foo", () => new Response("ok"));
		expect(trie.match("GET", "/bar")).toBeNull();
		// POST returns NotAllowed when GET is registered
		const postResult = trie.match("POST", "/foo");
		expect(postResult).not.toBeNull();
		expect(typeof postResult).toBe("object");
	});

	it("does not treat repeated slashes as empty route segments", () => {
		const handler = () => new Response("ok");
		trie.add("GET", "/users/:id", handler);
		expect(trie.match("GET", "/users//42")).toBeNull();
		expect(trie.match("GET", "/users/42")).not.toBeNull();
	});

	it("should handle route registration atomically (no partial state on invalid pattern)", () => {
		expect(() =>
			trie.add("GET", "invalid", () => new Response("ok")),
		).toThrow();
		expect(trie.match("GET", "/foo")).toBeNull();
	});

	it("should handle encoded slashes in routes", () => {
		const handler = () => new Response("ok");
		trie.add("GET", "/path%2Fwith%2Fslashes", handler);
		const matched = trie.match("GET", "/path%2Fwith%2Fslashes");
		expect(matched).toBe(handler);
	});

	it("should match method-specific routes", () => {
		const getHandler = () => new Response("get");
		const postHandler = () => new Response("post");
		trie.add("GET", "/api", getHandler);
		trie.add("POST", "/api", postHandler);

		expect(trie.match("GET", "/api")).toBe(getHandler);
		expect(trie.match("POST", "/api")).toBe(postHandler);
	});

	it("should match complex nested routes", () => {
		const handler = () => new Response("ok");
		trie.add("GET", "/api/users/:id/posts/:postId", handler);
		const matched = trie.match("GET", "/api/users/123/posts/456");
		expect(matched).not.toBeNull();
		expect(typeof matched).toBe("object");
		if (matched && typeof matched === "object" && MATCH_HANDLER in matched) {
			expect(matched[MATCH_HANDLER]).toBe(handler);
			expect(matched.id).toBe("123");
			expect(matched.postId).toBe("456");
		}
	});
});
