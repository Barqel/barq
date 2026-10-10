import { describe, expect, it } from "bun:test";
import { json, text } from "../src/http";

describe("HTTP response helpers", () => {
  it("preserves statusText and headers from ResponseInit", async () => {
    const jsonResponse = json(
      { ok: true },
      {
        status: 201,
        statusText: "Created by Barq",
        headers: { "x-test": "json" },
      },
    );
    expect(jsonResponse.statusText).toBe("Created by Barq");
    expect(jsonResponse.headers.get("x-test")).toBe("json");
    expect(jsonResponse.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );

    const textResponse = text("hello", {
      status: 202,
      statusText: "Accepted by Barq",
      headers: { "x-test": "text" },
    });
    expect(textResponse.statusText).toBe("Accepted by Barq");
    expect(textResponse.headers.get("x-test")).toBe("text");
    expect(textResponse.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await textResponse.text()).toBe("hello");
  });

  it("returns bodyless responses for status 205", async () => {
    const jsonResponse = json({ ignored: true }, 205);
    const textResponse = text("ignored", { status: 205 });
    expect(jsonResponse.status).toBe(205);
    expect(jsonResponse.body).toBeNull();
    expect(textResponse.status).toBe(205);
    expect(textResponse.body).toBeNull();
  });

  it("preserves an empty JSON body for values without a JSON representation", async () => {
    const response = json(undefined);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.body).toBeNull();
  });
});
