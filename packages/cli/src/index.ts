import { Cli } from "./cli";
import type { CliOptions } from "./types";

export * from "./types";
export * from "./parser";
export * from "./cli";

export function createCli(options: CliOptions = {}) {
	return new Cli(options);
}
