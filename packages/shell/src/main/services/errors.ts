/**
 * Canonical service-error names. Throwers stamp `err.name = ServiceErrorName.X`;
 * callers match on the enum. Centralising the literals here keeps the broker
 * envelope semantics + per-service throws aligned without a search-and-replace
 * trap when a name changes.
 *
 * The broker layer's `DenialReason` (`packages/shell/src/ipc/broker.ts`) is a
 * different, broader set — this enum is for the *throw-side* `err.name`
 * literals used inside service handlers.
 */

export enum ServiceErrorName {
	Invalid = "Invalid",
	Denied = "Denied",
	Unavailable = "Unavailable",
}

export function serviceError(name: ServiceErrorName, message: string): Error {
	const err = new Error(message);
	err.name = name;
	return err;
}
