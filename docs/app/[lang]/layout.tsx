import { RootProvider } from 'fumadocs-ui/provider/next';
import '../global.css';
import { i18nProvider } from 'fumadocs-ui/i18n';
import { LocaleProvider } from '@/components/locale-provider';
import { getDirection, i18n, translations } from '@/lib/i18n';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Barq documentation',
    template: '%s | Barq',
  },
  description: 'Documentation for the Barq HTTP and WebSocket framework.',
};

export default async function Layout(props: LayoutProps<'/[lang]'>) {
  const { lang } = await props.params;

  if (!i18n.languages.some((locale) => locale === lang)) notFound();

  return (
    <html lang={lang} dir={getDirection(lang)} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {/* the search index ships as a static asset, see `app/search.json/route.ts` */}
        <RootProvider search={{ options: { type: 'static', api: '/search.json' } }}>
          <LocaleProvider {...i18nProvider(translations, lang)}>{props.children}</LocaleProvider>
        </RootProvider>
      </body>
    </html>
  );
}