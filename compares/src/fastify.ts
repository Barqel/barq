import Fastify from "fastify";

const app = Fastify({ logger: false });
app.get("/health", async () => "ok");
app.get("/text", async () => "ok");
app.get("/json", async () => ({ message: "ok", count: 42 }));
app.get<{ Params: { id: string } }>("/users/:id", async (req) => ({
  id: req.params.id,
  name: "Ada",
}));
app.get<{ Querystring: { q?: string; page?: string } }>(
  "/search",
  async (req) => ({
    q: req.query.q ?? null,
    page: Number(req.query.page ?? 1),
  }),
);
app.post("/echo", async (req) => req.body);

const port = Number(Bun.env.PORT ?? 3103);
await app.listen({ port, host: "127.0.0.1" });
console.log(`Fastify listening on ${port}`);
