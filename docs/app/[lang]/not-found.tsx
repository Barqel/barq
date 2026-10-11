'use client';

import { StatusPage } from '@/components/status-page';
import { getPathLocale } from '@/lib/i18n';
import { notFoundCopy } from '@/lib/status';
import { usePathname } from 'next/navigation';

/**
 * Last-resort fallback for `notFound()` outside `app/[lang]/docs` — it has no
 * `DocsLayout` above it, so it renders bare.
 */
export default function NotFound() {
  const lang = getPathLocale(usePathname());
  const copy = notFoundCopy[lang] ?? notFoundCopy.en;

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-fd-muted-foreground text-5xl font-bold">{copy.code}</p>
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="text-fd-muted-foreground">{copy.description}</p>
      <a className="text-fd-primary font-medium underline" href={`/${lang}/docs`}>
        {copy.action}
      </a>
    </div>
  );
}