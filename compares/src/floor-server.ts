// The performance floor: bare Bun.serve doing the absolute minimum.
// Interleaved with barq + elysia so we can see how much headroom is left.

import { Elysia } from "elysia";
import { App } from "../../src/index";

const HDRS = new Headers({ "content-type": "application/json; charset=utf-8" });
const json = '{"id":"42","name":"Ada"}';

const bare = Bun.serve({
  port: Number(process.env.BARE_PORT ?? 3600),
  routes: {
    "/users/:id": () => new Response(json, { headers: HDRS }),
  },
  fetch: () => new Response("nf", { status: 404 }),
});

const barqApp = new App();
barqApp.get("/users/:id", (ctx) => ({ id: ctx.params.id, name: "Ada" }));
const barqServer = barqApp.listen(Number(process.env.BARQ_PORT ?? 3601));

const elyApp = new Elysia().get("/users/:id", ({ params }) => ({
  id: params.id,
  name: "Ada",
}));
elyApp.listen(Number(process.env.ELY_PORT ?? 3602));
console.log(
  `bare=${bare.port} barq=${barqServer.port} elysia=${elyApp.server?.port}`,
);
