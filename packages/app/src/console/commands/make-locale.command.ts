import { GeneratorCommand, moduleRoot, pascalCase } from "../generator";

export class MakeLocaleCommand extends GeneratorCommand {
	readonly signature = "locale:make <locale> [module]";

	override readonly description =
		"Create a locale dictionary in modules/<module>/locales";

	protected readonly stub = "locale.stub";

	/** The positional argument is the locale code, not a component name. */
	protected override readonly argumentName = "locale";

	/** Locale codes: "en", "ar", "pt-br", "zh_CN". */
	protected override readonly namePattern =
		/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/;

	protected className(locale: string): string {
		return `${pascalCase(locale)}Locale`;
	}

	protected outputPath(locale: string, module: string): string {
		return `${moduleRoot(module)}/locales/${locale}.ts`;
	}

	protected override hints(
		locale: string,
		_className: string,
		_relativePath: string,
		module: string,
	): string[] {
		return [
			`The file name is the locale key: \`${locale}\``,
			`Add the other languages under modules/${module}/locales`,
		];
	}
}
