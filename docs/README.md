# Barq documentation

The documentation site uses Next.js and Fumadocs. It supports English and
Arabic, including right-to-left layout for Arabic.

## Run locally

```bash
cd doc
bun install
bun run dev
```

Open `/en/docs/` for English or `/ar/docs/` for Arabic.

## Build and host

```bash
bun run build
```

The site is a **static export** (`output: 'export'` in `next.config.mjs`), so the
build writes plain HTML/CSS/JS to `out/` and needs no Node server. Serve it from
anything that can serve files, as long as the config maps directories to their
`index.html`:

```nginx
root /var/www/out;

location / {
    try_files $uri $uri/index.html =404;
}

error_page 404 /404.html;
```

Three things a static export changes, all of them load-bearing:

- **`proxy.ts` is gone.** There is no runtime to run it in, so `public/index.html`
  takes over `/`: it redirects to the language saved in `localStorage`, falling
  back to `Accept-Language`. That is the same precedence the proxy used.
- **`/api/search` is gone.** Search reads `request.url` to pick the locale, so it
  cannot be prerendered. `app/search.json/route.ts` builds the index at build time
  and exports it as a plain asset (~3 MB, fetched lazily when the dialog opens),
  and `RootProvider` points the dialog at it with `type: 'static'`.
- **Unknown URLs get `out/404.html`**, written by `app/not-found.tsx`. It renders
  standalone — no sidebar, no locale in the markup — and picks its language and
  direction from the URL in the browser.

`trailingSlash: true` is what makes `out/<route>/index.html` line up with the URLs
fumadocs emits. Links written by hand inside MDX are not rewritten, so they are
emitted without the trailing slash; the `try_files` rule above covers both.

Going back to a Node server means dropping `output: 'export'`, restoring
`proxy.ts` and `app/api/search/route.ts`, and setting the dialog back to its
default `api`.

## Content

Translated pages live under `content/docs/en` and `content/docs/ar`. Keep the
same relative page paths in both folders so the language switcher can open the
equivalent page. Each locale has its own `meta.json` files to order pages and
translate sidebar sections.

The locale configuration and shared UI translations are in `lib/i18n.ts`.

## Typography

`app/global.css` owns the type system. Fonts are self-hosted variable WOFF2
subsets in `public/fonts` (see the README there for details and licences):
Cairo for Arabic, Inter for Latin, each split by `unicode-range` so a page only
downloads the subset it renders.

Fumadocs derives every prose dimension — body text, heading sizes, inline code,
list indents, table padding — from the `--tw-prose-size` custom property. Set
that one variable (and `line-height`, which Fumadocs otherwise computes as an
absolute `rem` value) to rescale a page as a coherent modular scale, instead of
overriding `font-size` alone and leaving the rest of the scale behind.

Arabic and English carry different values for size, leading and line length;
Cairo needs more leading than Inter at the same size because of its taller
Arabic ascenders and descenders, and Arabic never takes letter-spacing since it
breaks cursive joining.
