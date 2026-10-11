import { DocsBody, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { StatusCopy } from '@/lib/status';
import Link from 'next/link';

/** Renders inside `DocsLayout`, so the sidebar and navbar are already around it. */
export function StatusPage({ lang, copy }: { lang: string; copy: StatusCopy }) {
  return (
    <DocsPage>
      <DocsTitle>{copy.title}</DocsTitle>
      <DocsBody>
        <p>{copy.description}</p>
        <p>
          <Link className="text-fd-primary font-medium underline" href={`/${lang}/docs`}>
            {copy.action}
          </Link>
        </p>
      </DocsBody>
    </DocsPage>
  );
}