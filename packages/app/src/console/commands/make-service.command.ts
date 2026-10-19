import { GeneratorCommand, pascalCase } from "../generator";

export class MakeServiceCommand extends GeneratorCommand {
	readonly signature = "service:make <name>";

	override readonly description = "Create a service in app/services";

	protected readonly stub = "service.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Service`;
	}

	protected outputPath(name: string): string {
		return `app/services/${name}.ts`;
	}

	protected override hints(): string[] {
		return ["Inject it into a controller via the constructor"];
	}
}
