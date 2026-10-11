import { describe, expect, it } from "bun:test";
import { App } from "../src/app";
import { cors } from "../src/cors";
import { type StandardSchemaV1, validateJson } from "../src/validation";

describe("Barq Architecture Fixes Verification", () => {
  it("verifies safe concurrency in FastLightContext when sync-declared function returns Promise", async () => {
    const app = new App();
    // Function not declared as async but returns Promise
    app.get("/sync-promise", (ctx) => {
      const query = ctx.queryParam("q");
      return Bun.sleep(15).then(() => ({ q: query }));
    });
    const server = app.listen(0);

    try {
      const [r1, r2] = await Promise.all([
        fetch(`http://localhost:${server.port}/sync-promise?q=req1`).then((r) =>
          r.json(),
        ),
        fetch(`http://localhost:${server.port}/sync-promise?q=req2`).then((r) =>
          r.json(),
        ),
      ]);
      expect(r1).toEqual({ q: "req1" });
      expect(r2).toEqual({ q: "req2" });
    } finally {
      await app.stop();
    }
  });

  it("verifies WebSocket beforeUpgrade custom data assignment", async () => {
    const app = new App();
    let attachedUserId: unknown;
    app.ws(
      "/ws-custom",
      {
        open(ws) {
          attachedUserId = (ws.data as { userId?: string })?.userId;
        },
      },
      (_ctx) => ({ data: { userId: "user-42" } }),
    );
    const server = app.listen(0);

    try {
      const ws = new WebSocket(`ws://localhost:${server.port}/ws-custom`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(e);
      });
      expect(attachedUserId).toBe("user-42");
      ws.close();
    } finally {
      await app.stop();
    }
  });

  it("verifies Standard Schema support in validateJson", async () => {
    const standardSchema: StandardSchemaV1<unknown, { count: number }> = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        validate(val: unknown) {
          if (typeof val === "object" && val !== null && "count" in val) {
            return {
              value: { count: Number((val as { count: unknown }).count) },
            };
          }
          return { issues: [{ message: "count is required" }] };
        },
      },
    };

    const app = new App();
    app.post(
      "/test-schema",
      validateJson(standardSchema, (_ctx, body) => {
        return Response.json({ success: true, count: body.count });
      }),
    );
    const server = app.listen(0);

    try {
      const okRes = await fetch(`http://localhost:${server.port}/test-schema`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 99 }),
      });
      expect(okRes.status).toBe(200);
      expect(await okRes.json()).toEqual({ success: true, count: 99 });

      const failRes = await fetch(
        `http://localhost:${server.port}/test-schema`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wrong: true }),
        },
      );
      expect(failRes.status).toBe(422);
    } finally {
      await app.stop();
    }
  });

  it("verifies zero-dependency CORS middleware preflight and simple requests", async () => {
    const app = new App().use(cors({ origin: "https://example.com" }));
    app.get("/cors-test", () => "hello");
    const server = app.listen(0);

    try {
      // Preflight
      const preflight = await fetch(
        `http://localhost:${server.port}/cors-test`,
        {
          method: "OPTIONS",
          headers: {
            Origin: "https://example.com",
            "Access-Control-Request-Method": "GET",
          },
        },
      );
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(
        "https://example.com",
      );

      // Actual request
      const getRes = await fetch(`http://localhost:${server.port}/cors-test`, {
        headers: { Origin: "https://example.com" },
      });
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("access-control-allow-origin")).toBe(
        "https://example.com",
      );
    } finally {
      await app.stop();
    }
  });
});
