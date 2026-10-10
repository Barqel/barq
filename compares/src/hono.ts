import { Hono } from "hono";

const app = new Hono();
app.get("/health", (c) => c.text("ok"));
app.get("/text", (c) => c.text("ok"));
app.get("/json", (c) => c.json({ message: "ok", count: 42 }));
app.get("/users/:id", (c) => c.json({ id: c.req.param("id"), name: "Ada" }));
app.get("/search", (c) =>
  c.json({
    q: c.req.query("q") ?? null,
    page: Number(c.req.query("page") ?? 1),
  }),
);
app.post("/echo", async (c) => c.json(await c.req.json()));

const port = Number(Bun.env.PORT ?? 3102);
const server = Bun.serve({ port, fetch: app.fetch });
console.log(`Hono listening on ${server.port}`);
