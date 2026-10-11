# Fonts

Self-hosted variable WOFF2 subsets, declared in `app/global.css` with
`unicode-range` so a page only downloads the script it actually renders.

| File               | Family | Script                | Weights  |
| ------------------ | ------ | --------------------- | -------- |
| `Cairo-Arabic.woff2` | Cairo  | Arabic (also Latin-ext) | 200–1000 |
| `Cairo-Latin.woff2`  | Cairo  | Latin                 | 200–1000 |
| `Inter-Latin.woff2`  | Inter  | Latin                 | 100–900  |

Arabic pages use Cairo first with Inter as the Latin fallback; English pages use
Inter first with Cairo as the fallback. Both are variable fonts, so weights
between the declared extremes (500, 600, …) render as real weights rather than
falling back to the nearest static face.

Both families are licensed under the SIL Open Font License 1.1 — see
`OFL-Cairo.txt` and `OFL-Inter.txt`. The fonts are subsets of the upstream
releases and are not modified.

To update a font, re-download the matching subset from Google Fonts and replace
the file; keep the filename, the `unicode-range` in `global.css` must stay in
sync with the subset you ship.