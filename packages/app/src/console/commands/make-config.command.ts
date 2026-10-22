import { GeneratorCommand, moduleRoot, pascalCase } from "../generator";

export class MakeConfigCommand extends GeneratorCommand {
	readonly signature = "config:make <name> [module]";

	override readonly description =
		"Create a config file in modules/<module>/config";

	protected readonly stub = "config.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Config`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/config/${name}.ts`;
	}

	protected override hints(
		name: string,
		_className: string,
		_relativePath: string,
		module: string,
	): string[] {
		return [
			`Import it with \`@modules/${module}/config/${name}\``,
			"Keep shared infrastructure settings in modules/shared/config",
		];
	}
}
