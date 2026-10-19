import { GeneratorCommand, pascalCase } from "../generator";

export class MakeControllerCommand extends GeneratorCommand {
	readonly signature = "controller:make <name>";

	override readonly description = "Create a controller in app/controllers/v1";

	protected readonly stub = "controller.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Controller`;
	}

	protected outputPath(name: string): string {
		return `app/controllers/v1/${name}.ts`;
	}

	protected override hints(): string[] {
		return ["Register its routes in app/routes/v1/api.ts"];
	}
}
