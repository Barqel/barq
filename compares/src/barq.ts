import { App } from "../../src/index";

const app = new App();
app.get("/health", () => "ok");
app.get("/text", () => "ok");
app.get("/json", () => ({ message: "ok", count: 42 }));
app.get("/users/:id", (ctx) => ({ id: ctx.params.id, name: "Ada" }));
app.get("/search", (ctx) => ({
  q: ctx.queryParam("q"),
  page: Number(ctx.queryParam("page") ?? 1),
}));
app.post("/echo", (ctx) => ctx.json());

const server = app.listen(Number(Bun.env.PORT ?? 3100));
console.log(`Barq listening on ${server.port}`);
