export function parseArgv(argv: string[]): {
	command: string | null;
	positionals: string[];
	flags: Record<string, any>;
} {
	const args = argv.slice(2);
	let command: string | null = null;
	const positionals: string[] = [];
	const flags: Record<string, any> = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;

		if (arg.startsWith("--")) {
			const equalIndex = arg.indexOf("=");
			if (equalIndex !== -1) {
				const key = arg.slice(2, equalIndex);
				const val = arg.slice(equalIndex + 1);
				flags[key] = coerce(val);
			} else {
				const key = arg.slice(2);
				if (key.startsWith("no-")) {
					flags[key.slice(3)] = false;
				} else {
					const next = args[i + 1];
					if (next !== undefined && !next.startsWith("-")) {
						flags[key] = coerce(next);
						i++;
					} else {
						flags[key] = true;
					}
				}
			}
			continue;
		}

		if (arg.startsWith("-") && arg.length > 1) {
			const key = arg.slice(1);
			const next = args[i + 1];
			if (next !== undefined && !next.startsWith("-")) {
				flags[key] = coerce(next);
				i++;
			} else {
				flags[key] = true;
			}
			continue;
		}

		if (command === null) {
			command = arg;
		} else {
			positionals.push(arg);
		}
	}

	return { command, positionals, flags };
}

function coerce(val: string): any {
	if (val === "true") return true;
	if (val === "false") return false;
	const num = Number(val);
	if (!Number.isNaN(num) && val.trim() !== "") return num;
	return val;
}
