import { Cli } from "./cli";
import type { CliOptions } from "./types";

export * from "./cli";
export * from "./parser";
export * from "./types";

export function createCli(options: CliOptions = {}) {
	return new Cli(options);
}
