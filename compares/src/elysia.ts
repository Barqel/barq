import { Elysia } from "elysia";

const app = new Elysia()
  .get("/health", () => new Response("ok"))
  .get("/text", () => "ok")
  .get("/json", () => ({ message: "ok", count: 42 }))
  .get("/users/:id", ({ params }) => ({ id: params.id, name: "Ada" }))
  .get("/search", ({ query }) => ({
    q: query.q ?? null,
    page: Number(query.page ?? 1),
  }))
  .post("/echo", ({ body }) => body)
  .listen(Number(Bun.env.PORT ?? 3101));

console.log(`Elysia listening on ${app.server?.port}`);
