import { GeneratorCommand, pascalCase } from "../generator";

export class MakeDtoCommand extends GeneratorCommand {
	readonly signature = "dto:make <name>";

	override readonly description = "Create a DTO in app/dtos";

	protected readonly stub = "dto.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Dto`;
	}

	protected outputPath(name: string): string {
		return `app/dtos/${name}.ts`;
	}

	protected override hints(): string[] {
		return ["Return it from an action or service — never the raw entity"];
	}
}
