import { App, json } from "../src";

const cookieSecret = Bun.env.COOKIE_SECRET;
if (!cookieSecret || cookieSecret.length < 32) {
  throw new Error("Set COOKIE_SECRET to a random secret of at least 32 characters");
}

const app = new App({
  cookieSecret,
  allowedRedirectHosts: ["docs.example.com"],
});

app.post("/session", (ctx) => {
  ctx.cookies.setSigned("session", "user-42", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  });
  return json({ signedIn: true });
});

app.get("/session", (ctx) => {
  const userId = ctx.cookies.getSigned("session");
  return userId
    ? json({ signedIn: true, userId })
    : json({ signedIn: false }, 401);
});

app.delete("/session", (ctx) => {
  ctx.cookies.delete("session", { path: "/", secure: true, sameSite: "Lax" });
  return json({ signedOut: true });
});

app.get("/docs", (ctx) => ctx.redirect("https://docs.example.com/barq"));

const server = app.listen(Number(Bun.env.PORT ?? 3000));
console.log(`Cookie example listening at http://localhost:${server.port}`);
