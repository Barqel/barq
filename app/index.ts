import { defineConfigAsync, start } from "@barq";

export const config = await defineConfigAsync({
	name: "Barq Starter Kit",
});

if (import.meta.main) {
	start(config);
}
