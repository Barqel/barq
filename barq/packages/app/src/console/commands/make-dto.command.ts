import { GeneratorCommand, moduleRoot, pascalCase } from "../generator";

export class MakeDtoCommand extends GeneratorCommand {
	readonly signature = "dto:make <name> [module]";

	override readonly description = "Create a DTO in modules/<module>/dtos";

	protected readonly stub = "dto.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Dto`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/dtos/${name}.ts`;
	}

	protected override hints(): string[] {
		return ["Return it from an action or service — never the raw entity"];
	}
}
