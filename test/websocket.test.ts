import { beforeEach, describe, expect, it } from "bun:test";
import { App } from "../src/app";

describe("WebSocket", () => {
  let app: App;

  beforeEach(() => {
    app = new App({ cookieSecret: "secret" });
  });

  it("should register WebSocket route", () => {
    const handlers = {
      open: () => {},
      message: () => {},
      close: () => {},
    };
    app.ws("/ws", handlers);
  });

  it("should register WebSocket route with beforeUpgrade", () => {
    const handlers = { message: () => {} };
    app.ws("/ws", handlers, (_ctx) => true);
  });

  it("should return 426 for non-websocket upgrade requests", async () => {
    const handlers = { message: () => {} };
    app.ws("/ws", handlers);

    const server = app.listen(0);
    const port = server.port;
    const res = await fetch(`http://localhost:${port}/ws`);
    expect(res.status).toBe(426);
    server.stop();
  });

  it("should return 401 when beforeUpgrade returns false", async () => {
    const handlers = { message: () => {} };
    app.ws("/ws", handlers, () => false);

    const server = app.listen(0);
    const port = server.port;
    const res = await fetch(`http://localhost:${port}/ws`, {
      headers: { upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
    server.stop();
  });
});
