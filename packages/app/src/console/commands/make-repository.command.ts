import { GeneratorCommand, moduleRoot, pascalCase } from "../generator";

export class MakeRepositoryCommand extends GeneratorCommand {
	readonly signature = "repository:make <name> [module]";

	override readonly description =
		"Create a repository in modules/<module>/repositories";

	protected readonly stub = "repository.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Repository`;
	}

	protected outputPath(name: string, module: string): string {
		return `${moduleRoot(module)}/repositories/${name}.ts`;
	}

	protected override hints(): string[] {
		return ["Inject it into a service via the constructor"];
	}
}
