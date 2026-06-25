/**
 * Shared error-shape factory for the storage worker.
 *
 * The broker reads `error.name` to derive the `EnvelopeReply` `error.kind`
 * value the SDK then surfaces as `Invalid` / `Unavailable` / etc. Keeping
 * the factory in one place stops the kind strings drifting between the
 * single-envelope path (`index.ts` `uploadFile`) and the chunked path
 * (`upload-session.ts`), and makes the eventual swap to a typed enum
 * (when the broker's error shape grows one) a single-file edit.
 */

export function makeWorkerError(kind: string, message: string): Error {
	const err = new Error(message);
	err.name = kind;
	return err;
}
