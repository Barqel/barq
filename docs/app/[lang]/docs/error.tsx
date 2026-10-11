'use client';

import { StatusPage } from '@/components/status-page';
import { getPathLocale } from '@/lib/i18n';
import { errorCopy } from '@/lib/status';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const lang = getPathLocale(usePathname());
  const copy = errorCopy[lang] ?? errorCopy.en;

  return (
    <div className="flex flex-col gap-3">
      <StatusPage lang={lang} copy={copy} />
      {error.digest && <p className="text-fd-muted-foreground text-sm">{error.digest}</p>}
      <p>
        <button type="button" onClick={retry} className="text-fd-primary font-medium underline">
          {copy.retry}
        </button>{' '}
        <Link className="text-fd-primary font-medium underline" href={`/${lang}/docs`}>
          {copy.action}
        </Link>
      </p>
    </div>
  );
}