// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  integrations: [
    starlight({
      title: "Barq",
      description: "Fast, typed HTTP and WebSocket services for Bun.",
      logo: {
        alt: "Barq",
        src: "./src/assets/logo.svg",
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Barqel/barq",
        },
      ],
      defaultLocale: "en",
      locales: {
        en: {
          label: "English",
          lang: "en",
        },
        ar: {
          label: "العربية",
          lang: "ar",
          dir: "rtl",
        },
      },
      customCss: ["./src/styles/custom.css"],
      components: {
        LanguageSelect: "./src/components/LanguageSelect.astro",
      },
      sidebar: [
        {
          label: "Introduction",
          translations: { ar: "مقدمة" },
          items: [
            { label: "What is Barq?", slug: "introduction/overview", translations: { ar: "ما هو Barq؟" } },
            { label: "Architecture", slug: "introduction/architecture", translations: { ar: "المعمارية الهندسية" } },
          ],
        },
        {
          label: "Getting started",
          translations: { ar: "البدء" },
          items: [
            { label: "Installation", slug: "getting-started/installation", translations: { ar: "التثبيت" } },
            { label: "Quickstart", slug: "getting-started/quickstart", translations: { ar: "البداية السريعة" } },
            { label: "Project structure", slug: "getting-started/project-structure", translations: { ar: "هيكل المشروع" } },
          ],
        },
        {
          label: "Core concepts",
          translations: { ar: "المفاهيم الأساسية" },
          items: [
            { label: "Routing", slug: "basics/routing", translations: { ar: "التوجيه والمسارات" } },
            { label: "Request context", slug: "basics/context", translations: { ar: "سياق الطلب" } },
            { label: "Middleware", slug: "basics/middleware", translations: { ar: "البرمجيات الوسيطة (Middleware)" } },
            { label: "Plugins", slug: "basics/plugins", translations: { ar: "نظام الإضافات (Plugins)" } },
            { label: "Responses", slug: "basics/responses", translations: { ar: "الاستجابات وإعادة التوجيه" } },
            { label: "Validation", slug: "basics/validation", translations: { ar: "التحقق من البيانات" } },
            { label: "Forms & Files", slug: "basics/form-data-and-files", translations: { ar: "الملفات والنماذج (FormData)" } },
            { label: "Errors & 404s", slug: "basics/errors", translations: { ar: "معالجة الأخطاء" } },
            { label: "Cookies", slug: "security/cookies", translations: { ar: "ملفات تعريف الارتباط" } },
          ],
        },
        {
          label: "Runtime",
          translations: { ar: "بيئة التشغيل المتقدمة" },
          items: [
            { label: "WebSockets", slug: "runtime/websockets", translations: { ar: "اتصالات WebSocket" } },
            { label: "Server & clustering", slug: "runtime/server", translations: { ar: "إعداد الخادم والتجميع" } },
            { label: "Production & security", slug: "runtime/production", translations: { ar: "الإنتاج والأمان" } },
          ],
        },
        {
          label: "Reference",
          translations: { ar: "المرجع" },
          items: [
            { label: "API Reference", slug: "api-reference", translations: { ar: "مرجع الواجهة البرمجية" } },
          ],
        },
      ],
    }),
  ],
});
