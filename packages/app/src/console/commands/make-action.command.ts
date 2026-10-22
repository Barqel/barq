import {
	DEFAULT_MODULE,
	GeneratorCommand,
	moduleRoot,
	pascalCase,
} from "../generator";

export class MakeActionCommand extends GeneratorCommand {
	readonly signature = "action:make <name> [module]";

	override readonly description =
		"Create a use-case action in modules/<module>/actions";

	protected readonly stub = "action.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Action`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/actions/${name}.ts`;
	}

	protected override hints(
		_name: string,
		_className: string,
		_relativePath: string,
		module: string,
	): string[] {
		const root = moduleRoot(module);
		const moduleFlag = module === DEFAULT_MODULE ? "" : ` ${module}`;

		return [
			"Inject it anywhere — controller, job or command — and call `handle()`",
			`Return a DTO from ${root}/dtos (\`dto:make <name>${moduleFlag}\`) — never the raw entity`,
		];
	}
}
