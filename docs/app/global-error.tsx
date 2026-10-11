'use client';

import { getDirection, getPathLocale, i18n } from '@/lib/i18n';
import { errorCopy } from '@/lib/status';
import { usePathname } from 'next/navigation';
import './global.css';

/**
 * Last-resort boundary: it replaces `app/[lang]/layout.tsx` entirely, so it has
 * to render its own document and re-import the global styles.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const lang = getPathLocale(usePathname());
  const copy = errorCopy[lang] ?? errorCopy[i18n.defaultLanguage];

  return (
    <html lang={lang} dir={getDirection(lang)}>
      <body
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          minHeight: '100vh',
          padding: '2rem',
          textAlign: 'center',
          fontFamily: 'var(--barq-font-sans)',
        }}
      >
        <p style={{ fontSize: '3rem', fontWeight: 700, opacity: 0.4 }}>{copy.code}</p>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{copy.title}</h1>
        <p style={{ maxWidth: '40ch', opacity: 0.8 }}>{copy.description}</p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button type="button" onClick={retry}>
            {copy.retry}
          </button>
          <a href={`/${lang}/docs`}>{copy.action}</a>
        </div>
      </body>
    </html>
  );
}