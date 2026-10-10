---
title: Form Data & File Uploads
description: Learn how to handle FormData, file uploads, streaming large files, and payload validation in Barq.
---

Barq is not limited to JSON APIs. It supports all standard HTTP request bodies and binary payloads with native performance on the Bun runtime.

## 1. Reading FormData & File Uploads

To process form data (`multipart/form-data` or `application/x-www-form-urlencoded`) and uploaded files, use `await ctx.formData()`:

```ts
import { App, json, HttpError } from "@barqel/barq";

const app = new App({
  // Configure maximum allowed request body size (e.g., 10MB)
  maxRequestBodySize: 10 * 1024 * 1024,
});

app.post("/upload", async (ctx) => {
  const form = await ctx.formData();

  // Read text field
  const username = form.get("username");

  // Read file field
  const avatar = form.get("avatar");

  if (!(avatar instanceof File)) {
    throw new HttpError(400, { error: "A valid file is required" });
  }

  console.log("Name:", avatar.name);
  console.log("Type:", avatar.type); // e.g., image/png
  console.log("Size:", avatar.size); // in bytes

  // Save the file to disk using Bun's native write
  await Bun.write(`./uploads/${avatar.name}`, avatar);

  return json({
    success: true,
    file: avatar.name,
    size: avatar.size,
  });
});
```

### Multiple File Uploads

When a form field uploads multiple files under the same key:

```ts
app.post("/upload-multiple", async (ctx) => {
  const form = await ctx.formData();
  const files = form.getAll("documents");
  const saved: string[] = [];

  for (const item of files) {
    if (item instanceof File) {
      await Bun.write(`./uploads/${item.name}`, item);
      saved.push(item.name);
    }
  }

  return json({ uploaded: saved });
});
```

---

## 2. File Validation

Validate file MIME types and size constraints before writing to disk:

```ts
app.post("/upload-avatar", async (ctx) => {
  const form = await ctx.formData();
  const file = form.get("avatar");

  if (!(file instanceof File)) {
    throw new HttpError(422, { error: "Avatar file is required" });
  }

  // 1. MIME type validation
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) {
    throw new HttpError(422, { error: "Only JPG, PNG, and WEBP images are allowed" });
  }

  // 2. File size limit (e.g., 2MB)
  const maxBytes = 2 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new HttpError(422, { error: "File size exceeds 2MB limit" });
  }

  await Bun.write(`./uploads/${Date.now()}-${file.name}`, file);
  return json({ message: "Avatar uploaded successfully" });
});
```

### Using Zod with FormData and Files

Zod supports standard `File` instances via `z.instanceof(File)`:

```ts
import { z } from "zod";
import { HttpError, json } from "@barqel/barq";

const UploadSchema = z.object({
  title: z.string().min(3),
  file: z.instanceof(File)
    .refine((f) => f.size <= 5 * 1024 * 1024, "File size must be under 5MB")
    .refine((f) => ["application/pdf"].includes(f.type), "Only PDF files are allowed"),
});

app.post("/documents", async (ctx) => {
  const form = await ctx.formData();

  const result = UploadSchema.safeParse({
    title: form.get("title"),
    file: form.get("file"),
  });

  if (!result.success) {
    throw new HttpError(422, {
      error: "Validation failed",
      issues: result.error.format(),
    });
  }

  const { title, file } = result.data;
  await Bun.write(`./docs/${file.name}`, file);

  return json({ success: true, title }, 201);
});
```

---

## 3. Large File Streaming

For large files (videos, dumps, datasets), avoid buffering the whole payload in memory. Use `ctx.bodyStream` to pipe directly to disk:

```ts
app.post("/upload-large", async (ctx) => {
  const stream = ctx.bodyStream;

  if (!stream) {
    throw new HttpError(400, { error: "Missing request stream" });
  }

  // Bun streams directly to disk without memory bloat
  await Bun.write("./uploads/large-file.bin", stream);

  return json({ message: "Stream received and saved successfully" });
});
```

---

## 4. Binary Data & Raw Text

* **`ctx.arrayBuffer()`**: Reads raw binary bytes (`ArrayBuffer`) for binary protocols and signatures.
* **`ctx.blob()`**: Accesses the body as a `Blob` preserving content-type metadata.
* **`ctx.text()`**: Parses plain text, XML, or CSV payloads.
