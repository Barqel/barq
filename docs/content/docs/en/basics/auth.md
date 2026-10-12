---
title: Authentication & JWT
description: High-performance, zero-dependency authentication, JWT signing and verification, and password hashing for Barq.
---

# Authentication & JWT

The `@barqel/barq-auth` plugin provides zero-dependency JWT (JSON Web Tokens), PBKDF2 password hashing, and role-based access control (RBAC) middleware for Barq.

## Installation

```bash
bun add @barqel/barq-auth
```

## Quick Start

```ts
import { App, json } from "@barqel/barq";
import { bearerAuth, hashPassword, requireRoles, signJwt, verifyPassword } from "@barqel/barq-auth";

const app = new App();
const JWT_SECRET = process.env.JWT_SECRET || "secure-random-secret-key-32-chars";

app.post("/login", async (ctx) => {
  const { email, password } = (await ctx.json()) as any;

  const valid = verifyPassword(password, storedHash);
  if (!valid) return json({ error: "Invalid credentials" }, 401);

  const token = signJwt({ sub: "user-1", email, role: "admin" }, JWT_SECRET, {
    expiresIn: "2h",
  });

  return json({ token });
});

app.get("/profile", bearerAuth({ secret: JWT_SECRET }), (ctx) => {
  return json({ user: ctx.state.user });
});

app.get(
  "/admin",
  bearerAuth({ secret: JWT_SECRET }),
  requireRoles("admin"),
  () => json({ secret: "administrative-data" }),
);

app.listen(3000);
```

## JWT API

### `signJwt(payload, secret, options?)`

Generates a signed JWT string.

```ts
const token = signJwt(
  { id: "usr_100", role: "member" },
  JWT_SECRET,
  { expiresIn: "1d", algorithm: "HS256" }
);
```

Available options:
* `expiresIn`: Number of seconds or duration string (e.g., `"15m"`, `"2h"`, `"7d"`).
* `notBefore`: Activation delay (e.g., `"5m"`).
* `algorithm`: `"HS256"` (default), `"HS384"`, or `"HS512"`.
* `issuer`, `subject`, `audience`, `jwtId`.

### `verifyJwt(token, secret, options?)`

Validates signature, expiration, and claims. Returns decoded payload or throws `AuthError`.

```ts
const payload = verifyJwt(token, JWT_SECRET, {
  issuer: "https://auth.example.com",
});
```

### `decodeJwt(token)`

Decodes token header and payload without verifying signature (useful for client-side inspection).

## Password Hashing

Zero-dependency PBKDF2 hashing with cryptographically secure random salt.

```ts
const hash = hashPassword("plain-password");
const isMatch = verifyPassword("plain-password", hash);
```

## Middleware

### `bearerAuth(options)`

Extracts token from `Authorization: Bearer <token>` header or cookies, verifies it, and attaches the decoded payload to `ctx.state.user`.

```ts
app.get("/dashboard", bearerAuth({ secret: JWT_SECRET }), (ctx) => {
  const user = ctx.state.user;
  return json({ id: user.sub });
});
```

### `requireRoles(...roles)`

Guards endpoints by requiring user roles populated in `ctx.state.user.role` or `ctx.state.user.roles`. Returns `403 Forbidden` on mismatch.

```ts
app.delete("/user/:id", bearerAuth({ secret: JWT_SECRET }), requireRoles("admin", "superadmin"), deleteUser);
```
