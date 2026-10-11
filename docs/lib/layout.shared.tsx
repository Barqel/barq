import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { i18n } from './i18n';
import { appName, gitConfig } from './shared';

export function baseOptions(locale: string): BaseLayoutProps {
  return {
    nav: { title: appName, url: `/${locale}/docs` },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    i18n: {
      defaultLanguage: i18n.defaultLanguage,
      languages: i18n.languages,
    },
  };
}
