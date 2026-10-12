import { App, json } from "../src";
import { i18nPlugin } from "../packages/i18n/src";

const app = new App();

app.plugin(
  i18nPlugin({
    defaultLocale: "en",
    locales: ["en", "ar", "fr"],
    translations: {
      en: {
        hello: "Hello, {user}!",
        checkout: { success: "Payment of ${amount} completed." },
      },
      ar: {
        hello: "أهلاً بك، {user}!",
        checkout: { success: "تمت عملية الدفع بمبلغ {amount}$ بنجاح." },
      },
      fr: {
        hello: "Bonjour, {user}!",
        checkout: { success: "Paiement de {amount}$ effectué." },
      },
    },
  })
);

app.get("/api/greet", (ctx) => {
  const t = (ctx as any).t;
  const name = ctx.queryParam("name") ?? "Developer";
  return json({
    locale: ctx.state.locale,
    greeting: t("hello", { user: name }),
    receipt: t("checkout.success", { amount: 150 }),
  });
});

const server = app.listen(3000);
console.log(`\n🚀 i18n localization demo running at http://localhost:${server.port}`);
console.log(`English: curl "http://localhost:${server.port}/api/greet?name=Ada"`);
console.log(`Arabic:  curl -H "Accept-Language: ar" "http://localhost:${server.port}/api/greet?name=عادا"`);
console.log(`French:  curl "http://localhost:${server.port}/api/greet?lang=fr&name=Ada"`);
