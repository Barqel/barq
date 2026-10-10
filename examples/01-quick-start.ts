import { App, empty, json, text } from "../src";

const app = new App();

app.get("/", () =>
  json({
    name: "Barq",
    message: "Your Bun HTTP server is running.",
  }),
);

app.get("/hello/:name", (ctx) => text(`Hello, ${ctx.params.name}!`));
app.get("/health", () => empty(204));

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`Barq listening at http://localhost:${server.port}`);
