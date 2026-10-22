// Request-class stamp for handler functions.
//
// `action(run)` needs the request class at runtime, but a method's
// parameter types are erased — `@validatedBy(Request)` stamps the class onto
// the method, and `controller()` carries the stamp over to its bound copy.
const REQUEST_CLASS = Symbol.for("@barqel/barq.requestClass");

export function attachRequestClass(fn: unknown, Request: unknown): void {
	(fn as Record<PropertyKey, unknown>)[REQUEST_CLASS] = Request;
}

export function readRequestClass(fn: unknown): unknown {
	return (fn as Record<PropertyKey, unknown> | undefined)?.[REQUEST_CLASS];
}
