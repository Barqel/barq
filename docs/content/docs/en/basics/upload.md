---
title: API File Uploads
description: Zero-dependency, secure multipart file uploads with size limits, MIME validation, and disk storage for Barq APIs.
---

# API File Uploads

The `@barqel/barq-upload` plugin provides a highly secure, memory-efficient middleware for parsing `multipart/form-data` requests, validating files, and safely storing them to disk.

## Installation

```bash
bun add @barqel/barq-upload
```

## Quick Start

Create a specialized upload middleware for your API routes to validate file size, count, and allowed MIME types:

```ts
import { App, json } from "@barqel/barq";
import { upload, type UploadedFile } from "@barqel/barq-upload";

const app = new App();

const documentUpload = upload({
  dest: "./storage/documents",
  maxFileSize: 10 * 1024 * 1024, // 10 MB limit
  maxFiles: 3,                   // Max 3 files per request
  accept: ["application/pdf"],   // Only PDF allowed
});

app.post("/api/documents", documentUpload, (ctx) => {
  // Access validated and saved files via ctx.state.files
  const files = ctx.state.files as UploadedFile[];
  
  if (files.length === 0) {
    return json({ error: "No files uploaded" }, 400);
  }

  return json({
    uploaded: files.map(f => ({
      name: f.name,
      savedAs: f.savedAs,
      size: f.size
    }))
  }, 201);
});

app.listen(3000);
```

## Security Features

The middleware automatically enforces limits *before* any business logic is executed:
* Returns `413 Payload Too Large` if a file exceeds `maxFileSize` or if `maxFiles` is breached.
* Returns `415 Unsupported Media Type` if the file's MIME type isn't in the `accept` array.
* Generates cryptographically random UUIDs for filenames by default to prevent directory traversal and overwrite attacks.

## In-Memory vs. Disk Storage

If you omit the `dest` option, the plugin will parse and validate the files but keep them as standard `File` objects in memory (or temporary OS buffers on Bun). You can then stream them directly to AWS S3, Cloudflare R2, or a database:

```ts
const memoryUpload = upload({ maxFileSize: 5 * 1024 * 1024 });

app.post("/api/avatar", memoryUpload, async (ctx) => {
  const files = ctx.state.files as UploadedFile[];
  const avatarFile = files[0].file; // Standard Web API File object
  
  await s3Client.putObject({
    Bucket: "avatars",
    Key: `usr_123.png`,
    Body: avatarFile,
  });

  return json({ success: true });
});
```

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `dest` | `string` | `undefined` | Directory path where files will be securely saved to disk |
| `maxFileSize` | `number` | `Infinity` | Maximum allowed file size in bytes |
| `maxFiles` | `number` | `Infinity` | Maximum number of files processed per request |
| `accept` | `string[]` | `undefined` | Array of allowed MIME types (e.g., `["image/png"]`) |
| `generateFilename` | `(file: File) => string` | `UUID + Ext`| Custom filename generator hook |
| `createDestDir` | `boolean` | `true` | Automatically creates the `dest` directory if it is missing |
