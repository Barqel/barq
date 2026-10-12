import { describe, expect, it } from "bun:test";
import { App, json } from "@barqel/barq";
import { i18nPlugin, negotiateLocale } from "../src/index";

describe("@barqel/barq-i18n", () => {
	it("negotiates locale accurately based on q-weights", () => {
		const header = "fr;q=0.7, ar;q=0.9, en;q=0.8";
		const selected = negotiateLocale(header, ["en", "fr", "ar"], "en");
		expect(selected).toBe("ar");
	});

	it("translates nested keys with parameter interpolation", async () => {
		const app = new App();
		app.plugin(
			i18nPlugin({
				defaultLocale: "en",
				locales: ["en", "ar"],
				translations: {
					en: {
						welcome: "Welcome, {name}!",
						errors: { notFound: "Resource not found" },
					},
					ar: {
						welcome: "مرحباً، {name}!",
						errors: { notFound: "المورد غير موجود" },
					},
				},
			}),
		);

		app.get("/greeting", (ctx) => {
			const t = (ctx as any).t;
			return json({
				message: t("welcome", { name: "Ada" }),
				error: t("errors.notFound"),
			});
		});

		const server = app.listen(0);

		try {
			const resEn = await fetch(`http://localhost:${server.port}/greeting`, {
				headers: { "Accept-Language": "en" },
			});
			expect(resEn.headers.get("content-language")).toBe("en");
			expect(await resEn.json()).toEqual({
				message: "Welcome, Ada!",
				error: "Resource not found",
			});

			const resAr = await fetch(`http://localhost:${server.port}/greeting?lang=ar`);
			expect(resAr.headers.get("content-language")).toBe("ar");
			expect(await resAr.json()).toEqual({
				message: "مرحباً، Ada!",
				error: "المورد غير موجود",
			});
		} finally {
			await app.stop();
		}
	});
});
