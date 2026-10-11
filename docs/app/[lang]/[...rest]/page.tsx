import { notFound } from 'next/navigation';

/**
 * Catch-all so URLs like `/en/typo` reach `app/[lang]/not-found.tsx` — which
 * runs under `app/[lang]/layout.tsx` and therefore keeps the locale, `dir` and
 * theme — instead of Next's document-level default, which has none of those.
 */
export default function Page() {
  notFound();
}