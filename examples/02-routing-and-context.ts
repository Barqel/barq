import { App, json } from "../src";

const app = new App();

app.get("/users/:userId", (ctx) =>
  json({
    userId: ctx.params.userId,
    pathname: ctx.pathname,
    search: ctx.queryParam("search"),
    tags: ctx.queryParamAll("tag"),
    // Use ctx.query when the route needs the complete query collection.
    page: Number(ctx.query.get("page") ?? 1),
  }),
);

app.get("/posts/:postId?", (ctx) =>
  json({ postId: ctx.params.postId ?? null }),
);

app.get("/files/*path", (ctx) =>
  json({ requestedFile: ctx.params.path }),
);

app.post("/echo", async (ctx) => json(await ctx.json<unknown>()));
app.post("/plain-text", async (ctx) => new Response(await ctx.text()));
app.put("/users/:userId", (ctx) =>
  json({ updated: ctx.params.userId }),
);
app.patch("/users/:userId", (ctx) =>
  json({ patched: ctx.params.userId }),
);
app.delete("/users/:userId", (ctx) =>
  json({ deleted: ctx.params.userId }),
);
app.head("/status", () => new Response("healthy"));
app.options(
  "/status",
  () => new Response(null, { headers: { allow: "GET, HEAD, OPTIONS" } }),
);

// Register a handler for every supported HTTP method at this path.
app.all("/method-check", (ctx) => json({ method: ctx.req.method }));

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`Try http://localhost:${server.port}/users/u-42?tag=js&tag=bun`);
