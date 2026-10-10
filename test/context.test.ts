import { describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { Context, type ContextApplication } from "../src/context";

describe("Context", () => {
  const createReq = (url: string, headers: Record<string, string> = {}) => {
    const h = new Headers(headers);
    return new Request(url, { headers: h });
  };

  const createApplication = (
    trustProxy: ContextApplication["trustProxy"] = false,
    cookieSecret = "secret",
  ): ContextApplication => ({
    development: false,
    redirectHosts: new Set(),
    trustProxy,
    cookieSecret,
  });

  const createCtx = (url: string, headers: Record<string, string> = {}) => {
    return new Context(createReq(url, headers), null, {}, createApplication());
  };

  describe("body parsing", () => {
    it("parses JSON and caches the parsed body for other readers", async () => {
      const req = new Request("http://example.com/", {
        method: "POST",
        body: '{"message":"ok"}',
      });
      const ctx = new Context(req, null, {}, createApplication());

      await expect(ctx.json()).resolves.toEqual({ message: "ok" });
      await expect(ctx.json()).resolves.toEqual({ message: "ok" });
      expect(req.bodyUsed).toBe(true);
      await expect(ctx.text()).resolves.toBe('{"message":"ok"}');
    });

    it("uses the shared body buffer when another reader started first", async () => {
      const ctx = new Context(
        new Request("http://example.com/", {
          method: "POST",
          body: '{"message":"ok"}',
        }),
        null,
        {},
        createApplication(),
      );

      await expect(ctx.text()).resolves.toBe('{"message":"ok"}');
      await expect(ctx.json()).resolves.toEqual({ message: "ok" });
    });
  });

  describe("queryParam", () => {
    it("should return value for existing param", () => {
      const ctx = createCtx("http://example.com/?foo=bar");
      expect(ctx.queryParam("foo")).toBe("bar");
    });

    it("should return null for missing param", () => {
      const ctx = createCtx("http://example.com/");
      expect(ctx.queryParam("foo")).toBeNull();
    });

    it("should return empty string for param without value (?foo)", () => {
      const ctx = createCtx("http://example.com/?foo");
      expect(ctx.queryParam("foo")).toBe("");
    });

    it("should return empty string for param with empty value (?foo=)", () => {
      const ctx = createCtx("http://example.com/?foo=");
      expect(ctx.queryParam("foo")).toBe("");
    });

    it("should return first value for duplicate params", () => {
      const ctx = createCtx("http://example.com/?foo=bar&foo=baz");
      expect(ctx.queryParam("foo")).toBe("bar");
    });

    it("does not create URLSearchParams for a single lookup", () => {
      const ctx = createCtx("http://example.com/?foo=bar&baz=qux");
      expect(ctx.queryParam("foo")).toBe("bar");
      expect(
        (ctx as unknown as { _query: URLSearchParams | null })._query,
      ).toBe(null);
    });

    it("decodes form keys and values like URLSearchParams", () => {
      const ctx = createCtx(
        "http://example.com/?first+name=Jane+Doe&x=%E0%A4%A",
      );
      expect(ctx.queryParam("first name")).toBe("Jane Doe");
      expect(ctx.queryParam("x")).toBe(
        new URLSearchParams("x=%E0%A4%A").get("x"),
      );
    });

    it("should return all values for queryParamAll", () => {
      const ctx = createCtx("http://example.com/?foo=bar&foo=baz");
      expect(ctx.queryParamAll("foo")).toEqual(["bar", "baz"]);
    });

    it("should return empty array for missing param in queryParamAll", () => {
      const ctx = createCtx("http://example.com/");
      expect(ctx.queryParamAll("foo")).toEqual([]);
    });
  });

  describe("IP parsing", () => {
    it("walks a trusted forwarded chain from the nearest proxy", () => {
      const server = {
        requestIP: () => ({ address: "10.0.0.2" }),
      } as unknown as Server<unknown>;
      const ctx = new Context(
        createReq("http://example.com/", {
          "x-forwarded-for": "203.0.113.90, 198.51.100.7, 10.0.0.1",
        }),
        server,
        {},
        createApplication(["10.0.0.0/8"]),
      );
      expect(ctx.ip).toBe("198.51.100.7");
    });

    it("ignores forwarded headers from an untrusted peer", () => {
      const server = {
        requestIP: () => ({ address: "198.51.100.10" }),
      } as unknown as Server<unknown>;
      const ctx = new Context(
        createReq("http://example.com/", {
          "x-forwarded-for": "203.0.113.90",
        }),
        server,
        {},
        createApplication(["10.0.0.0/8"]),
      );
      expect(ctx.ip).toBe("198.51.100.10");
    });

    it("ignores malformed forwarded chains", () => {
      const server = {
        requestIP: () => ({ address: "10.0.0.2" }),
      } as unknown as Server<unknown>;
      const ctx = new Context(
        createReq("http://example.com/", {
          "x-forwarded-for": "203.0.113.1, not-an-ip",
        }),
        server,
        {},
        createApplication(["10.0.0.0/8"]),
      );
      expect(ctx.ip).toBe("10.0.0.2");
    });

    it("should parse IPv4 from x-forwarded-for when trustProxy is true", () => {
      const ctx = new Context(
        createReq("http://example.com/", { "x-forwarded-for": "192.168.1.1" }),
        null,
        {},
        createApplication(true),
      );
      expect(ctx.ip).toBe("192.168.1.1");
    });

    it("should parse IPv6 from x-forwarded-for when trustProxy is true", () => {
      const ctx = new Context(
        createReq("http://example.com/", { "x-forwarded-for": "2001:db8::1" }),
        null,
        {},
        createApplication(true),
      );
      expect(ctx.ip).toBe("2001:db8::1");
    });

    it("should handle IPv6 with :: compression when trustProxy is true", () => {
      const ctx = new Context(
        createReq("http://example.com/", { "x-forwarded-for": "::1" }),
        null,
        {},
        createApplication(true),
      );
      expect(ctx.ip).toBe("::1");
    });

    it("should handle IPv6 loopback when trustProxy is true", () => {
      const ctx = new Context(
        createReq("http://example.com/", {
          "x-forwarded-for": "::ffff:127.0.0.1",
        }),
        null,
        {},
        createApplication(true),
      );
      expect(ctx.ip).toBe("::ffff:127.0.0.1");
    });

    it("should fallback to empty string when no proxy and no server", () => {
      const req = createReq("http://example.com/");
      const ctx = new Context(req, null, {}, createApplication());
      expect(ctx.ip).toBe("");
    });
  });

  describe("cookies", () => {
    it("should create CookieJar with secret", () => {
      const ctx = createCtx("http://example.com/");
      expect(ctx.cookies).toBeDefined();
      expect(ctx.cookies.set).toBeDefined();
    });

    it("should parse cookies from request headers", () => {
      const ctx = createCtx("http://example.com/", {
        cookie: "session=abc123",
      });
      expect(ctx.cookies.get("session")).toBe("abc123");
    });
  });

  describe("state", () => {
    it("should provide state object", () => {
      const ctx = createCtx("http://example.com/");
      ctx.state.user = { name: "John" };
      expect(ctx.state.user).toEqual({ name: "John" });
    });

    it("should return empty object initially", () => {
      const ctx = createCtx("http://example.com/");
      expect(ctx.state).toEqual({});
    });
  });

  describe("application configuration", () => {
    it("reads server settings through the application reference", () => {
      const redirectHosts = new Set(["example.com"]);
      const application = {
        development: true,
        redirectHosts,
        trustProxy: "10.0.0.0/8",
        cookieSecret: "app-secret",
      } satisfies ContextApplication;
      const ctx = new Context(
        createReq("http://example.com/"),
        null,
        {},
        application,
      );

      expect(ctx.development).toBe(true);
      expect(ctx.redirectHosts).toBe(redirectHosts);
      expect(ctx.trustProxy).toBe("10.0.0.0/8");
      expect(() => ctx.cookies.setSigned("session", "value")).not.toThrow();
    });
  });

  describe("pathname", () => {
    it("should return pathname from URL", () => {
      const ctx = createCtx("http://example.com/foo/bar?baz=qux");
      expect(ctx.pathname).toBe("/foo/bar");
    });
  });
});
