# Barq documentation

The documentation site uses Next.js and Fumadocs. It supports English and
Arabic, including right-to-left layout for Arabic.

## Run locally

```bash
cd doc
bun install
bun run dev
```

Open `/en/docs` for English or `/ar/docs` for Arabic. The site root redirects to
the default locale's documentation.

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
