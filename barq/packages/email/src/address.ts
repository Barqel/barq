// Address helpers — nodemailer accepts a lot of shapes for a recipient
// (a string, a list, a `{ name, address }` pair, nested lists). These
// helpers flatten them into plain strings, so the plugin can log, count
// and validate them without caring about the input shape.

/** A named address. */
export interface MailAddressObject {
	name?: string;
	address: string;
}

/** One address, or a list of them — everything nodemailer accepts. */
export type MailAddress =
	| string
	| string[]
	| MailAddressObject
	| MailAddressObject[]
	| (string | MailAddressObject)[];

/** Flattens any accepted address shape into a list of plain addresses. */
export function flattenAddresses(value: unknown): string[] {
	if (value === undefined || value === null) {
		return [];
	}

	if (typeof value === "string") {
		return value.trim() === "" ? [] : [value.trim()];
	}

	if (Array.isArray(value)) {
		return value.flatMap((entry) => flattenAddresses(entry));
	}

	if (typeof value === "object" && "address" in value) {
		const address = (value as MailAddressObject).address;
		return typeof address === "string" && address.trim() !== ""
			? [address.trim()]
			: [];
	}

	return [];
}

/**
 * Builds the `Name <address>` form used by the `from` and `reply-to`
 * headers. An address that already carries a name is left untouched.
 */
export function formatAddress(
	name: string | undefined,
	address: string,
): string {
	if (!name || name.trim() === "") {
		return address;
	}

	if (address.includes("<")) {
		return address;
	}

	return `${name.trim()} <${address}>`;
}
