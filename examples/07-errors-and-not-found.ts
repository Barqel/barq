import { App, HttpError, json } from "../src";

const app = new App({ development: false });

app.notFound((ctx) =>
  json({ error: "Not Found", path: ctx.pathname }, 404),
);

app.onError((error) => {
  if (error instanceof HttpError) {
    return json({ error: error.message, details: error.body }, error.status);
  }

  // Log the full error on the server; keep internal details out of the response.
  console.error("Request failed:", error);
  return json({ error: "Internal Server Error" }, 500);
});

app.get("/teapot", () => {
  throw new HttpError(418, { error: "The kettle is busy" });
});

app.get("/unexpected", () => {
  throw new Error("Example internal failure");
});

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`Error-handling example listening at http://localhost:${server.port}`);
