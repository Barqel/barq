---
title: Cookies
description: Read, set, sign, and delete HTTP cookies in Barq applications on Bun and Node.js.
---

Cookies are accessed through `ctx.cookies`, a request-scoped `CookieJar`. Incoming cookies are parsed when the jar is first used. Writes are appended to the outgoing response as `Set-Cookie` headers.

```ts
app.get("/preferences", (ctx) => {
  const theme = ctx.cookies.get("theme") ?? "system";
  return json({ theme });
});

app.post("/preferences", (ctx) => {
  ctx.cookies.set("theme", "dark", {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: true,
    sameSite: "Lax",
  });
  return json({ saved: true });
});
```

`get(name)` returns a string or `undefined`. Cookie values are URL-encoded when written and decoded when read.

## Cookie options

`set(name, value, options?)` accepts `path`, `domain`, `maxAge`, `expires`, `httpOnly`, `secure`, and `sameSite`. Cookies are `HttpOnly` by default, and `SameSite` defaults to `Lax`. Set `secure: true` when serving over HTTPS. `SameSite=None` requires `secure: true`.

Deleting a cookie writes an expired cookie. Use the same path/domain scope as the cookie being removed:

```ts
ctx.cookies.delete("theme", { path: "/", secure: true, sameSite: "Lax" });
```

## Signed cookies

Configure a non-empty, high-entropy secret outside source control:

```ts
const app = new App({ cookieSecret: process.env.COOKIE_SECRET });
```

Set and read signed values with `setSigned()` and `getSigned()`:

```ts
ctx.cookies.setSigned("session", "user-42", {
  path: "/",
  secure: true,
  sameSite: "Lax",
});

const userId = ctx.cookies.getSigned("session"); // string or null
```

`getSigned()` returns `null` when verification fails or no signing secret is configured. An optional custom secret can be passed to the signed-cookie methods. Signing detects tampering; it does not encrypt or conceal the cookie value. Store only values that are safe for the client to see.

Cookie prefixes are enforced: `__Secure-` requires `secure`, and `__Host-` requires `secure`, `path: "/"`, and no `domain`.
