---
title: Security Headers (Helmet)
description: Zero-dependency, high-performance HTTP security headers and CSP middleware for Barq.
---

# Security Headers (Helmet)

The `@barqel/barq-helmet` plugin secures Barq applications by setting standard HTTP security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) with zero external dependencies and precomputed header overhead.

## Installation

```bash
bun add @barqel/barq-helmet
```

## Quick Start

### Global Protection

Apply default secure headers globally using `app.plugin()`:

```ts
import { App, json } from "@barqel/barq";
import { helmetPlugin } from "@barqel/barq-helmet";

const app = new App();

app.plugin(helmetPlugin());

app.get("/api/data", () => json({ secure: true }));
app.listen(3000);
```

### Route-specific Middleware

Apply security headers to specific route handlers:

```ts
import { App, json } from "@barqel/barq";
import { helmet } from "@barqel/barq-helmet";

const app = new App();

app.get(
  "/admin",
  helmet({
    xFrameOptions: "DENY",
    referrerPolicy: "same-origin",
  }),
  (ctx) => json({ admin: true }),
);
```

## Content Security Policy (CSP)

Customize CSP directives:

```ts
app.plugin(
  helmetPlugin({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: true,
      },
    },
  }),
);
```

## Headers Set by Default

* `X-Content-Type-Options: nosniff`
* `X-Frame-Options: SAMEORIGIN`
* `Strict-Transport-Security: max-age=31536000; includeSubDomains`
* `X-Download-Options: noopen`
* `X-Permitted-Cross-Domain-Policies: none`
* `X-DNS-Prefetch-Control: off`
* `X-XSS-Protection: 0`
* `Referrer-Policy: no-referrer`
* `Cross-Origin-Opener-Policy: same-origin`
* `Cross-Origin-Resource-Policy: same-origin`
* `Origin-Agent-Cluster: ?1`
* Strips `X-Powered-By` header automatically.

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `contentSecurityPolicy` | `boolean \| CspOptions` | `false` | Sets `Content-Security-Policy` header |
| `xFrameOptions` | `boolean \| "DENY" \| "SAMEORIGIN"` | `"SAMEORIGIN"` | Sets `X-Frame-Options` against clickjacking |
| `strictTransportSecurity` | `boolean \| HstsOptions` | `true` | Enforces HTTPS with `Strict-Transport-Security` |
| `xContentTypeOptions` | `boolean` | `true` | Mitigates MIME sniffing |
| `referrerPolicy` | `boolean \| string \| string[]` | `"no-referrer"` | Sets `Referrer-Policy` |
| `crossOriginOpenerPolicy` | `boolean \| string` | `"same-origin"` | Sets `Cross-Origin-Opener-Policy` |
| `crossOriginResourcePolicy` | `boolean \| string` | `"same-origin"` | Sets `Cross-Origin-Resource-Policy` |
| `originAgentCluster` | `boolean` | `true` | Sets `Origin-Agent-Cluster: ?1` |
| `xPoweredBy` | `boolean` | `false` | Strips `X-Powered-By` when false |
