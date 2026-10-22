import { GeneratorCommand, moduleRoot, pascalCase } from "../generator";

export class MakeMailCommand extends GeneratorCommand {
	readonly signature = "mail:make <name> [module]";

	override readonly description = "Create a mail in modules/<module>/mail";

	protected readonly stub = "mail.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Mail`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/mail/${name}.ts`;
	}

	protected override hints(
		_name: string,
		className: string,
		_relativePath: string,
		_module: string,
	): string[] {
		return [
			`Inject ${className} anywhere and call \`send(to, data)\``,
			"Or compose it yourself with `mailer().send({ to, template, data })`",
		];
	}
}
