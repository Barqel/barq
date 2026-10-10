import { App, empty, json } from "../src";

const app = new App({ maxRequestBodySize: 2 * 1024 * 1024 });

app.post("/json", async (ctx) => json(await ctx.json<unknown>()));
app.post("/text", async (ctx) => new Response(await ctx.text()));
app.post("/bytes", async (ctx) =>
  new Response(await ctx.arrayBuffer(), {
    headers: { "content-type": "application/octet-stream" },
  }),
);
app.post("/blob", async (ctx) => {
  const blob = await ctx.blob();
  return json({ size: blob.size, type: blob.type });
});
app.post("/form", async (ctx) => {
  const form = await ctx.formData();
  const upload = form.get("file");
  return json({
    name: form.get("name"),
    fileName: upload instanceof File ? upload.name : null,
    fileSize: upload instanceof File ? upload.size : null,
  });
});
app.post("/stream", (ctx) => {
  const body = ctx.bodyStream;
  return body === null ? empty(204) : new Response(body);
});

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`Body helper example listening at http://localhost:${server.port}`);
