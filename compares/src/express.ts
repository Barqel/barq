import express from "express";

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.send("ok"));
app.get("/text", (_req, res) => res.send("ok"));
app.get("/json", (_req, res) => res.json({ message: "ok", count: 42 }));
app.get("/users/:id", (req, res) =>
  res.json({ id: req.params.id, name: "Ada" }),
);
app.get("/search", (req, res) =>
  res.json({
    q: req.query.q ?? null,
    page: Number(req.query.page ?? 1),
  }),
);
app.post("/echo", (req, res) => res.json(req.body));

const port = Number(Bun.env.PORT ?? 3104);
app.listen(port, "127.0.0.1", () =>
  console.log(`Express listening on ${port}`),
);
