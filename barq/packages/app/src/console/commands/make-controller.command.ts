import { GeneratorCommand, moduleRoot, pascalCase } from "../generator";

export class MakeControllerCommand extends GeneratorCommand {
	readonly signature = "controller:make <name> [module]";

	override readonly description =
		"Create a controller in modules/<module>/controllers";

	protected readonly stub = "controller.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Controller`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/controllers/${name}.ts`;
	}

	protected override hints(
		_name: string,
		_className: string,
		_relativePath: string,
		module: string,
	): string[] {
		return [`Register its routes in modules/${module}/routes/routes.ts`];
	}
}
