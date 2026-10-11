export interface StatusCopy {
  code: string;
  title: string;
  description: string;
  action: string;
}

export interface ErrorCopy extends StatusCopy {
  retry: string;
}

export const notFoundCopy: Record<string, StatusCopy> = {
  en: {
    code: '404',
    title: 'Page not found',
    description: 'The page you were looking for was moved, renamed, or never existed in the first place.',
    action: 'Back to the docs',
  },
  ar: {
    code: '404',
    title: 'الصفحة غير موجودة',
    description: 'الصفحة اللي بتدوّر عليها اتنقلت، أو اسمها اتغيّر، أوهي أصلاً مكانش موجودة.',
    action: 'ارجع للوثائق',
  },
};

export const errorCopy: Record<string, ErrorCopy> = {
  en: {
    code: '500',
    title: 'Something went wrong',
    description: 'An unexpected error stopped this page from rendering. Try again, and if it keeps happening, let us know.',
    action: 'Back to the docs',
    retry: 'Try again',
  },
  ar: {
    code: '500',
    title: 'حصل خطأ ما',
    description: 'خطأ غير متوقع منع الصفحة دي من العرض. جرّب تاني، ولو بيكرر كلّمنا.',
    action: 'ارجع للوثائق',
    retry: 'جرّب تاني',
  },
};