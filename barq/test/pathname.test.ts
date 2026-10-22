import { describe, expect, it } from "bun:test";
import {
	hasEncodedSlash,
	normalizeDotSegments,
	parseRequestTarget,
	scanPathname,
} from "../src/internal/pathname";

describe("pathname", () => {
	describe("scanPathname", () => {
		it("should extract pathname from URL", () => {
			expect(scanPathname("http://example.com/foo/bar")).toBe("/foo/bar");
		});

		it("preserves :// within origin-form paths", () => {
			expect(scanPathname("/foo://bar/baz")).toBe("/foo://bar/baz");
			expect(parseRequestTarget("/foo://bar/baz?x=1")).toEqual({
				pathname: "/foo://bar/baz",
				query: "x=1",
			});
		});

		it("should handle root path", () => {
			expect(scanPathname("http://example.com/")).toBe("/");
		});

		it("should handle no path", () => {
			expect(scanPathname("http://example.com")).toBe("/");
		});

		it("should handle query string", () => {
			expect(scanPathname("http://example.com/foo?bar=baz")).toBe("/foo");
		});

		it("should handle hash fragment", () => {
			expect(scanPathname("http://example.com/foo#bar")).toBe("/foo");
		});

		it("should preserve encoded slashes", () => {
			expect(scanPathname("http://example.com/foo%2Fbar")).toBe("/foo%2Fbar");
			expect(scanPathname("http://example.com/foo%2fbar")).toBe("/foo%2fbar");
		});

		it("should normalize dot segments", () => {
			expect(scanPathname("http://example.com/foo/./bar")).toBe("/foo/bar");
			expect(scanPathname("http://example.com/foo/../bar")).toBe("/bar");
			expect(scanPathname("http://example.com/foo/../../bar")).toBe("/bar");
		});

		it("should preserve trailing slash when present", () => {
			expect(scanPathname("http://example.com/foo/")).toBe("/foo/");
			expect(scanPathname("http://example.com/foo/./")).toBe("/foo/");
		});

		it("should handle encoded dots", () => {
			expect(scanPathname("http://example.com/foo/%2e/bar")).toBe("/foo/bar");
			expect(scanPathname("http://example.com/foo/%2e%2e/bar")).toBe("/bar");
		});
	});

	describe("normalizeDotSegments", () => {
		it("should remove single dot segments", () => {
			expect(normalizeDotSegments("/foo/./bar")).toBe("/foo/bar");
		});

		it("should remove double dot segments", () => {
			expect(normalizeDotSegments("/foo/../bar")).toBe("/bar");
			expect(normalizeDotSegments("/foo/bar/../baz")).toBe("/foo/baz");
		});

		it("should handle multiple dot segments", () => {
			expect(normalizeDotSegments("/a/b/../../c")).toBe("/c");
			expect(normalizeDotSegments("/a/./b/./c")).toBe("/a/b/c");
		});

		it("should preserve leading slash", () => {
			expect(normalizeDotSegments("/foo")).toBe("/foo");
		});

		it("should preserve trailing slash", () => {
			expect(normalizeDotSegments("/foo/")).toBe("/foo/");
			expect(normalizeDotSegments("/foo/./")).toBe("/foo/");
		});

		it("should handle root path", () => {
			expect(normalizeDotSegments("/")).toBe("/");
		});

		it("should not go above root", () => {
			expect(normalizeDotSegments("/../../foo")).toBe("/foo");
		});
	});

	describe("hasEncodedSlash", () => {
		it("should detect lowercase encoded slash", () => {
			expect(hasEncodedSlash("/foo%2fbar")).toBe(true);
		});

		it("should detect uppercase encoded slash", () => {
			expect(hasEncodedSlash("/foo%2Fbar")).toBe(true);
		});

		it("should return false for normal paths", () => {
			expect(hasEncodedSlash("/foo/bar")).toBe(false);
		});
	});
});
