/**
 * Welcome-2 template codec (9.3.5.V 7d) — the **entities-export JSON** format
 * for bundled vault templates (OQ-WC-3 resolution (b), user-confirmed).
 *
 * A template is a curated set of entities (a `TemplateManifest`) shipped as
 * build-time JSON; importing it merges those entities into the current vault
 * through the same create+plant path `runWelcomeSeed` already uses, namespaced
 * under a parent Collection so Bin removes the whole template cleanly. This is
 * the pure, dependency-free serialization half: build a manifest from a set of
 * entities, and parse one back **defensively** — a hand-edited / forward-
 * version / partially-written manifest coerces to safe values or drops a bad
 * row rather than throwing (mirrors `entityToList`), so one corrupt template
 * never breaks the gallery. The import-merge + parent-Collection bundling is
 * the wiring follow-up (it reuses this + `listToEntityProperties` + the seeder).
 */

import type { WelcomeBody } from "./welcome-content";

export const TEMPLATE_MANIFEST_VERSION = 1 as const;

/** One entity in a template — the `WelcomeStarterEntity` shape generalised to
 *  any `type`. `body` (a serialized editor state) rides along for note-bodied
 *  entities, planted into the universal-body Y.Doc on import. */
export type TemplateEntity = {
	id: string;
	type: string;
	properties: Record<string, unknown>;
	body?: WelcomeBody;
};

/** A bundled template: a stable id (the per-vault "already imported" stamp +
 *  the parent Collection id derive from it), display name/description, and the
 *  entity set. */
export type TemplateManifest = {
	version: number;
	id: string;
	name: string;
	description: string;
	entities: TemplateEntity[];
};

export type BuildTemplateInput = {
	id: string;
	name: string;
	description?: string;
	entities: ReadonlyArray<TemplateEntity>;
};

/** Build a manifest from a curated entity set (build-time authoring helper). */
export function buildTemplateManifest(input: BuildTemplateInput): TemplateManifest {
	return {
		version: TEMPLATE_MANIFEST_VERSION,
		id: input.id,
		name: input.name,
		description: input.description ?? "",
		entities: input.entities.map((e) => ({
			id: e.id,
			type: e.type,
			properties: e.properties,
			...(e.body ? { body: e.body } : {}),
		})),
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

/** Coerce one raw entity, or `null` if it lacks the load-bearing fields
 *  (a non-empty `id` + `type`). Properties default to `{}`; a non-object
 *  `body` is dropped (the entity imports body-less rather than failing). */
function parseEntity(raw: unknown): TemplateEntity | null {
	if (!isObject(raw)) return null;
	const id = asString(raw.id);
	const type = asString(raw.type);
	if (id === "" || type === "") return null;
	const properties = isObject(raw.properties) ? raw.properties : {};
	const entity: TemplateEntity = { id, type, properties };
	if (isObject(raw.body) && isObject((raw.body as { root?: unknown }).root)) {
		entity.body = raw.body as WelcomeBody;
	}
	return entity;
}

/**
 * Parse a raw value (parsed JSON) into a `TemplateManifest`, or `null` when it
 * isn't a usable template (not an object, missing id/name, or no valid
 * entities). Forward-version-tolerant: a higher `version` still parses (the
 * defensive field coercion is the compatibility layer, per OQ-WC-3); a missing
 * version defaults to 1. Malformed individual entities are dropped, not fatal.
 */
export function parseTemplateManifest(raw: unknown): TemplateManifest | null {
	if (!isObject(raw)) return null;
	const id = asString(raw.id);
	const name = asString(raw.name);
	if (id === "" || name === "") return null;
	const entitiesRaw = Array.isArray(raw.entities) ? raw.entities : [];
	const entities: TemplateEntity[] = [];
	for (const e of entitiesRaw) {
		const parsed = parseEntity(e);
		if (parsed) entities.push(parsed);
	}
	if (entities.length === 0) return null;
	const version = typeof raw.version === "number" && raw.version > 0 ? raw.version : 1;
	return { version, id, name, description: asString(raw.description), entities };
}
