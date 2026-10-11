import { defineI18n } from 'fumadocs-core/i18n';
import { uiTranslations } from 'fumadocs-ui/i18n';

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'ar'],
  hideLocale: 'never',
  parser: 'dir',
});

const rtlLanguages = new Set<string>(['ar']);

export function getDirection(locale: string): 'rtl' | 'ltr' {
  return rtlLanguages.has(locale) ? 'rtl' : 'ltr';
}

/** Reads the locale out of a pathname like `/ar/docs/foo`, for route boundaries. */
export function getPathLocale(pathname: string): string {
  const segment = pathname.split('/')[1];

  return i18n.languages.some((language) => language === segment) ? segment : i18n.defaultLanguage;
}

export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    en: {
      'Ask AI(AI chat button)': 'Ask AI',
      'Back to Home(404 not found page)': 'Back to Home',
      'Choose a language(language switcher)': 'Choose a language',
      'Choose a language(language switcher)(aria-label)': 'Choose a language',
      'Close Banner(banner)(aria-label)': 'Close banner',
      'Close Search(search dialog)(aria-label)': 'Close search',
      'Close Sidebar(aria-label)': 'Close sidebar',
      'Close Sidebar(sidebar)(aria-label)': 'Close sidebar',
      'Collapse Sidebar(sidebar)(aria-label)': 'Collapse sidebar',
      'Copied Anchor Link(heading anchor)(aria-label)': 'Copied anchor link',
      'Copied Link(accordion)(aria-label)': 'Copied link',
      'Copied Markdown(page actions)': 'Copied Markdown',
      'Copied Text(code block)(aria-label)': 'Copied text',
      'Copy Anchor Link(heading anchor)(aria-label)': 'Copy anchor link',
      'Copy Link(accordion)(aria-label)': 'Copy link',
      'Copy Markdown(page actions)': 'Copy Markdown',
      'Copy Text(code block)(aria-label)': 'Copy text',
      'Dark(theme switcher)(aria-label)': 'Dark',
      'Default(type table)': 'Default',
      'Edit on GitHub(edit page)': 'Edit on GitHub',
      'Hide Sidebar(sidebar)': 'Hide sidebar',
      'Language(language switcher)': 'Language',
      'Last updated on(page footer)': 'Last updated on',
      'Layout Tab(layout tab trigger)': 'Layout',
      'Light(theme switcher)(aria-label)': 'Light',
      'Next Page(pagination)': 'Next page',
      'No Headings(table of contents)': 'No headings',
      'No results found(search dialog)': 'No results found',
      'On this page(table of contents)': 'On this page',
      'Open Search(search trigger)(aria-label)': 'Open search',
      'Open Sidebar(aria-label)': 'Open sidebar',
      'Open Sidebar(sidebar)(aria-label)': 'Open sidebar',
      'Open in ChatGPT(page actions)': 'Open in ChatGPT',
      'Open in Claude(page actions)': 'Open in Claude',
      'Open in Cursor(page actions)': 'Open in Cursor',
      'Open in GitHub(page actions)': 'Open in GitHub',
      'Open in Scira AI(page actions)': 'Open in Scira AI',
      'Open(page actions)': 'Open',
      'Options(aria-label)': 'Options',
      'Page Not Found(404 not found page)': 'Page not found',
      'Parameters(type table)': 'Parameters',
      'Previous Page(pagination)': 'Previous page',
      'Prop(type table)': 'Property',
      'Read {url}, I want to ask questions about it.(page actions)':
        'Read {url}, I want to ask questions about it.',
      'Returns(type table)': 'Returns',
      'Search(search dialog)': 'Search',
      'Search(search trigger)': 'Search',
      'Show Sidebar(sidebar)': 'Show sidebar',
      'System(theme switcher)(aria-label)': 'System',
      'Table of Contents(inline table of contents)': 'Table of contents',
      'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 not found page)':
        'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.',
      'Theme(site menu)': 'Theme',
      'Toggle Menu(home layout header)(aria-label)': 'Toggle menu',
      'Toggle Theme(theme switcher)(aria-label)': 'Toggle theme',
      'Type(type table)': 'Type',
      'View as Markdown(page actions)': 'View as Markdown',
      displayName: 'English',
    },
    ar: {
      'Ask AI(AI chat button)': 'اسأل الذكاء الاصطناعي',
      'Back to Home(404 not found page)': 'العودة إلى الصفحة الرئيسية',
      'Choose a language(language switcher)': 'اختر اللغة',
      'Choose a language(language switcher)(aria-label)': 'اختر اللغة',
      'Close Banner(banner)(aria-label)': 'إغلاق الشريط',
      'Close Search(search dialog)(aria-label)': 'إغلاق البحث',
      'Close Sidebar(aria-label)': 'إغلاق الشريط الجانبي',
      'Close Sidebar(sidebar)(aria-label)': 'إغلاق الشريط الجانبي',
      'Collapse Sidebar(sidebar)(aria-label)': 'طي الشريط الجانبي',
      'Copied Anchor Link(heading anchor)(aria-label)': 'تم نسخ رابط العنوان',
      'Copied Link(accordion)(aria-label)': 'تم نسخ الرابط',
      'Copied Markdown(page actions)': 'تم نسخ Markdown',
      'Copied Text(code block)(aria-label)': 'تم نسخ النص',
      'Copy Anchor Link(heading anchor)(aria-label)': 'نسخ رابط العنوان',
      'Copy Link(accordion)(aria-label)': 'نسخ الرابط',
      'Copy Markdown(page actions)': 'نسخ Markdown',
      'Copy Text(code block)(aria-label)': 'نسخ النص',
      'Dark(theme switcher)(aria-label)': 'داكن',
      'Default(type table)': 'افتراضي',
      'Edit on GitHub(edit page)': 'تعديل على GitHub',
      'Hide Sidebar(sidebar)': 'إخفاء الشريط الجانبي',
      'Language(language switcher)': 'اللغة',
      'Last updated on(page footer)': 'آخر تحديث في',
      'Layout Tab(layout tab trigger)': 'التخطيط',
      'Light(theme switcher)(aria-label)': 'فاتح',
      'Next Page(pagination)': 'الصفحة التالية',
      'No Headings(table of contents)': 'لا توجد عناوين',
      'No results found(search dialog)': 'لا توجد نتائج',
      'On this page(table of contents)': 'في هذه الصفحة',
      'Open Search(search trigger)(aria-label)': 'فتح البحث',
      'Open Sidebar(aria-label)': 'فتح الشريط الجانبي',
      'Open Sidebar(sidebar)(aria-label)': 'فتح الشريط الجانبي',
      'Open in ChatGPT(page actions)': 'فتح في ChatGPT',
      'Open in Claude(page actions)': 'فتح في Claude',
      'Open in Cursor(page actions)': 'فتح في Cursor',
      'Open in GitHub(page actions)': 'فتح في GitHub',
      'Open in Scira AI(page actions)': 'فتح في Scira AI',
      'Open(page actions)': 'فتح',
      'Options(aria-label)': 'خيارات',
      'Page Not Found(404 not found page)': 'الصفحة غير موجودة',
      'Parameters(type table)': 'المعاملات',
      'Previous Page(pagination)': 'الصفحة السابقة',
      'Prop(type table)': 'الخاصية',
      'Read {url}, I want to ask questions about it.(page actions)':
        'اقرأ {url}، أريد طرح أسئلة حولها.',
      'Returns(type table)': 'القيمة المعادة',
      'Search(search dialog)': 'بحث',
      'Search(search trigger)': 'بحث',
      'Show Sidebar(sidebar)': 'إظهار الشريط الجانبي',
      'System(theme switcher)(aria-label)': 'النظام',
      'Table of Contents(inline table of contents)': 'جدول المحتويات',
      'The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.(404 not found page)':
        'ربما أزيلت الصفحة التي تبحث عنها أو تغير اسمها أو أنها غير متاحة مؤقتًا.',
      'Theme(site menu)': 'المظهر',
      'Toggle Menu(home layout header)(aria-label)': 'تبديل القائمة',
      'Toggle Theme(theme switcher)(aria-label)': 'تبديل المظهر',
      'Type(type table)': 'النوع',
      'View as Markdown(page actions)': 'عرض بصيغة Markdown',
      displayName: 'العربية',
    },
  });
