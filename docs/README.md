# Barq documentation

This folder contains the bilingual documentation website for Barq, a TypeScript HTTP and WebSocket core for Bun.

## Run locally

```sh
bun install
bun run dev
```

Astro prints the local URL after the development server starts.

## Build and preview

```sh
bun run build
bun run preview
```

Documentation pages live in `src/content/docs/`. English pages are at the root of that directory; Arabic translations live under `ar/`. The sidebar and language metadata are configured in `astro.config.mjs`.

All API and usage examples should reflect the Barq implementation in the repository root. Barq does not provide an ORM, database, authentication, CLI, queue, or job-scheduling system; do not document those as built-in features.
