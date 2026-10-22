import { GeneratorCommand, moduleRoot, pascalCase } from "../generator";

export class MakeServiceCommand extends GeneratorCommand {
	readonly signature = "service:make <name> [module]";

	override readonly description =
		"Create a service in modules/<module>/services";

	protected readonly stub = "service.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Service`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/services/${name}.ts`;
	}

	protected override hints(): string[] {
		return ["Inject it into a controller via the constructor"];
	}
}
