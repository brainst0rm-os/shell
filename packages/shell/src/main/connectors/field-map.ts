/**
 * Connector-4 — `applyFieldMap`: translate an external resource into vault
 * entity properties via the connector-declared map (doc 56 §`SyncMapping`,
 * OQ-CN-1 resolved: the connector ships a default; overrides are later).
 *
 * Pure + isolated (the connector-author-overridable surface). Each entry maps
 * an entity property to either:
 *   - a (possibly dotted) resource field path — `"user.login"`; or
 *   - a value map `{ from, map, default? }` that reads `from` and translates
 *     the external value through `map` (e.g. a provider enum `open`/`closed`
 *     into the vault's `Task` status `todo`/`done`). An unmapped value falls
 *     back to `default` if given, otherwise the property is left unset rather
 *     than written raw — so a provider value never escapes into a typed enum.
 */

/** Read a possibly-dotted path out of a resource object; undefined if any
 *  segment is missing or a non-object is traversed. */
export function readPath(resource: unknown, path: string): unknown {
	let cursor: unknown = resource;
	for (const segment of path.split(".")) {
		if (cursor === null || typeof cursor !== "object") return undefined;
		cursor = (cursor as Record<string, unknown>)[segment];
	}
	return cursor;
}

/** A value-translating field-map entry: read `from`, look the external value
 *  up in `map`, fall back to `default` when absent. */
export type ValueMapEntry = {
	from: string;
	map: Record<string, unknown>;
	default?: unknown;
};

function isValueMapEntry(source: unknown): source is ValueMapEntry {
	return (
		typeof source === "object" &&
		source !== null &&
		typeof (source as ValueMapEntry).from === "string" &&
		typeof (source as ValueMapEntry).map === "object" &&
		(source as ValueMapEntry).map !== null
	);
}

/** Project a resource into entity properties. Maps with an undefined source
 *  field are skipped (the property simply isn't set), never written as
 *  `undefined`. */
export function applyFieldMap(
	fieldMap: Record<string, unknown>,
	resource: unknown,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [entityProp, source] of Object.entries(fieldMap)) {
		if (typeof source === "string") {
			const value = readPath(resource, source);
			if (value !== undefined) out[entityProp] = value;
		} else if (isValueMapEntry(source)) {
			const raw = readPath(resource, source.from);
			if (raw === undefined) continue;
			const mapped = source.map[String(raw)];
			if (mapped !== undefined) out[entityProp] = mapped;
			else if (source.default !== undefined) out[entityProp] = source.default;
		}
	}
	return out;
}
