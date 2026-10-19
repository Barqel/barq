import { GeneratorCommand, pascalCase } from "../generator";

export class MakeRepositoryCommand extends GeneratorCommand {
	readonly signature = "repository:make <name>";

	override readonly description = "Create a repository in app/repositories";

	protected readonly stub = "repository.stub";

	protected className(name: string): string {
		return `${pascalCase(name)}Repository`;
	}

	protected outputPath(name: string): string {
		return `app/repositories/${name}.ts`;
	}

	protected override hints(): string[] {
		return ["Inject it into a service via the constructor"];
	}
}
