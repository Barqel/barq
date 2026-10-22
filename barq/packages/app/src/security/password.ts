// Password rules — Laravel's `Password::min(8)->mixedCase()->numbers()`.
//
//   import { Password } from "@barq";
//
//   const rule = Password.of().min(8).mixedCase().numbers();
//   rule.validate("Passw0rd"); // → true
//   rule.assert("weak");       // → throws WeakPasswordError
//
// The rule is built fluently and then reused wherever the app accepts a
// password (sign-up, reset, change).
export type PasswordIssue =
	| "tooShort"
	| "tooLong"
	| "missingUppercase"
	| "missingLowercase"
	| "missingDigit"
	| "missingSymbol";

/** The password breaks the rule. */
export class WeakPasswordError extends Error {
	readonly issues: PasswordIssue[];

	constructor(issues: PasswordIssue[]) {
		super(`Weak password: ${issues.join(", ")}`);
		this.name = "WeakPasswordError";
		this.issues = issues;
	}
}

/** A fluent password rule. */
export class Password {
	private minLength = 0;
	private maxLength = Number.POSITIVE_INFINITY;
	private uppercase = false;
	private lowercase = false;
	private digit = false;
	private symbol = false;

	/** Starts a rule. */
	static of(): Password {
		return new Password();
	}

	/** Minimum length. */
	min(length: number): this {
		this.minLength = length;

		return this;
	}

	/** Maximum length. */
	max(length: number): this {
		this.maxLength = length;

		return this;
	}

	/** Requires an uppercase and a lowercase letter. */
	mixedCase(): this {
		this.uppercase = true;
		this.lowercase = true;

		return this;
	}

	/** Requires a digit. */
	numbers(): this {
		this.digit = true;

		return this;
	}

	/** Requires a symbol (anything that is not a letter or a digit). */
	symbols(): this {
		this.symbol = true;

		return this;
	}

	/** Every rule the password breaks. */
	issues(value: string): PasswordIssue[] {
		const issues: PasswordIssue[] = [];

		if (value.length < this.minLength) {
			issues.push("tooShort");
		}

		if (value.length > this.maxLength) {
			issues.push("tooLong");
		}

		if (this.uppercase && !/[A-Z]/.test(value)) {
			issues.push("missingUppercase");
		}

		if (this.lowercase && !/[a-z]/.test(value)) {
			issues.push("missingLowercase");
		}

		if (this.digit && !/\d/.test(value)) {
			issues.push("missingDigit");
		}

		if (this.symbol && !/[^A-Za-z0-9]/.test(value)) {
			issues.push("missingSymbol");
		}

		return issues;
	}

	/** True when the password satisfies every rule. */
	validate(value: string): boolean {
		return this.issues(value).length === 0;
	}

	/** Throws `WeakPasswordError` when the password breaks a rule. */
	assert(value: string): void {
		const issues = this.issues(value);

		if (issues.length > 0) {
			throw new WeakPasswordError(issues);
		}
	}
}
