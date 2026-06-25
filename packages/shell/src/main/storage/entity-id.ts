/**
 * Shared `entityId` validator for the persistence funnel.
 *
 * An entity id is used downstream as a filesystem-path component (via
 * `YDocStore.pathFor` → `mkdir` + `writeFile`), a SQL row key (`entities` /
 * `entity_deks`), a mutex Map key, and the relay routing-header `entityId`.
 * The path usage makes a permissive id a path-traversal sink — `path.join(
 * baseDir, "../../../etc/foo")` escapes the vault data dir and `appendUpdate`
 * happily writes there (the 10.9b pentest finding). Brainstorm entity ids are
 * the `[A-Za-z0-9_-]{1,128}` ULID/string-id family used everywhere else;
 * anything outside that set is rejected at every trust boundary that can be
 * handed a caller-supplied id (the `entities.create` service boundary and the
 * ydoc worker's persistence handlers) so no downstream sink needs to repeat
 * the check.
 */

export const SAFE_ENTITY_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** True iff `value` is a string that is safe to use as an entity id. */
export function isSafeEntityId(value: unknown): value is string {
	return typeof value === "string" && SAFE_ENTITY_ID_RE.test(value);
}

/**
 * Throw if `value` is not a safe entity id. The thrown error's `name` is
 * `"Invalid"` so a broker service that surfaces `error.name` as the reply kind
 * maps an unsafe id to the standard `Invalid` reply without extra plumbing.
 */
export function assertSafeEntityId(value: unknown): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		const err = new Error("entityId must be a non-empty string");
		err.name = "Invalid";
		throw err;
	}
	if (!SAFE_ENTITY_ID_RE.test(value)) {
		const err = new Error(
			"entityId must match /^[A-Za-z0-9_-]{1,128}$/ (rejects path traversal, NUL, slash, dot-dot)",
		);
		err.name = "Invalid";
		throw err;
	}
}
