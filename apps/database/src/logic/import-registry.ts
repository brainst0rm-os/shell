/**
 * Generic per-type import mapper registry (9.12.16, third keystone).
 *
 * The plan: "the mapper-registry primitive is generic — future types
 * (Tasks ← .ics / .todoist, Books ← .opml / Goodreads CSV) plug in
 * without renderer changes." The two contact-import keystones
 * (`contact-import.ts` parse, `contact-import-plan.ts` dedupe/commit)
 * already exist; this is the abstraction that lets the still-pending
 * thin UI slice be **type-agnostic** — it asks the registry for the
 * mapper that claims a file's extension, then drives one uniform
 * `detect → parse → plan → (override) → commands` pipeline regardless of
 * the entity type.
 *
 * Pure + dependency-free (no DOM, no Files host, no entities service —
 * that wiring layers on top and is the genuinely dep-gated remainder).
 * Mirrors the Preview app's lazy-loader registry discipline: a
 * different mapper rebound to an already-claimed type throws at
 * registration, not at first use.
 */

import {
	ContactImportFormat,
	PERSON_TYPE,
	type PersonDraft,
	detectContactFormat,
	importContacts,
} from "./contact-import";
import type {
	ExistingPerson,
	ImportAction,
	ImportCommand,
	ImportPlanRow,
} from "./contact-import-plan";
import { commandsFor, planImport, summarize } from "./contact-import-plan";

export { ImportAction } from "./contact-import-plan";
export type { ImportCommand } from "./contact-import-plan";

/** Minimal shape of an existing row for dedupe — structurally the same
 *  as `ExistingPerson`; the generic name reflects that the registry
 *  isn't Person-specific. */
export type ExistingEntity = { id: string; properties: Record<string, unknown> };

export type ImportSummary = { create: number; merge: number; skip: number };

/**
 * One per importable entity type. `D` is the parsed-draft shape, `R` the
 * per-row plan shape — both opaque to the registry/UI, which only ever
 * pass them straight back into the same mapper's later steps. The
 * **commands** + **summary** are the shared, type-agnostic vocabulary
 * the entities-service caller consumes.
 */
export type TypeImportMapper<D = unknown, R = unknown> = {
	/** Canonical entity-type URL this mapper imports into. */
	typeUrl: string;
	/** Human label for the picker ("Contacts"). */
	label: string;
	/** Lower-case file extensions (no dot) this mapper claims. */
	extensions: readonly string[];
	/** Decide the concrete source format from filename + a content sniff. */
	detectFormat(filename: string, content: string): string;
	/** Parse raw file text into drafts (best-effort; never throws). */
	parse(content: string, format: string): D[];
	/** Dedupe drafts against existing rows → per-row plan (default
	 *  Merge-on-match / Create-otherwise). */
	planImport(drafts: readonly D[], existing: readonly ExistingEntity[]): R[];
	/** Resolve the (optionally UI-overridden) plan to commit commands.
	 *  `propertyOverrides` carries the slice-2 preview grid's per-row,
	 *  per-field edits (keyed by plan index), shallow-merged onto the
	 *  resolved bag. */
	commandsFor(
		plan: readonly R[],
		overrides?: Readonly<Record<number, ImportAction>>,
		propertyOverrides?: Readonly<Record<number, Record<string, unknown>>>,
	): ImportCommand[];
	/** Header counts for the preview ("3 new · 2 merge · 1 skip"). */
	summarize(plan: readonly R[], overrides?: Readonly<Record<number, ImportAction>>): ImportSummary;
};

const REGISTRY = new Map<string, TypeImportMapper>();

/** Register a mapper. Idempotent for the same object; a *different*
 *  mapper for an already-claimed type is the copy-paste-rebind bug —
 *  thrown at boot, not silently shadowed. */
export function registerImportMapper(mapper: TypeImportMapper): void {
	const existing = REGISTRY.get(mapper.typeUrl);
	if (existing && existing !== mapper) {
		throw new Error(
			`import-registry: type ${mapper.typeUrl} already has a different mapper — refusing to overwrite`,
		);
	}
	REGISTRY.set(mapper.typeUrl, mapper);
}

export function importMapperForType(typeUrl: string): TypeImportMapper | null {
	return REGISTRY.get(typeUrl) ?? null;
}

/** The mapper that claims `ext` (case-insensitive, leading dot
 *  tolerated). First registered wins on an extension collision. */
export function importMapperForExtension(ext: string): TypeImportMapper | null {
	const norm = ext.replace(/^\./, "").toLowerCase();
	for (const m of REGISTRY.values()) {
		if (m.extensions.includes(norm)) return m;
	}
	return null;
}

export function registeredImportTypeUrls(): string[] {
	return [...REGISTRY.keys()];
}

/** Test-only — production never un-registers a mapper. */
export function _resetImportRegistryForTests(): void {
	REGISTRY.clear();
}

export type ImportRun<R = unknown> = {
	format: string;
	drafts: unknown[];
	plan: R[];
	commands: ImportCommand[];
	summary: ImportSummary;
};

/**
 * One-call orchestration the thin UI uses: detect → parse → plan, then
 * resolve commands + summary for the (optionally overridden) plan. The
 * UI keeps `plan` to render the preview + collect per-row overrides,
 * then re-derives `commands`/`summary` via `mapper.commandsFor` /
 * `mapper.summarize` on commit (this returns the no-override baseline).
 */
export function runImport<D = unknown, R = unknown>(
	mapper: TypeImportMapper<D, R>,
	filename: string,
	content: string,
	existing: readonly ExistingEntity[],
): ImportRun<R> {
	const format = mapper.detectFormat(filename, content);
	const drafts = mapper.parse(content, format);
	const plan = mapper.planImport(drafts, existing);
	return {
		format,
		drafts,
		plan,
		commands: mapper.commandsFor(plan),
		summary: mapper.summarize(plan),
	};
}

// ─── Built-in mappers ──────────────────────────────────────────────────────

/** Contacts (`Person/v1`) ← vCard / CSV — composes the existing
 *  contact-import + plan keystones into the generic shape. */
export const contactsImportMapper: TypeImportMapper<PersonDraft, ImportPlanRow> = {
	typeUrl: PERSON_TYPE,
	label: "Contacts",
	extensions: ["vcf", "csv"],
	detectFormat: (filename, content) => detectContactFormat(filename, content),
	parse: (content, format) =>
		importContacts(
			content,
			format === ContactImportFormat.VCard ? ContactImportFormat.VCard : ContactImportFormat.Csv,
		),
	planImport: (drafts, existing) => planImport(drafts, existing as ReadonlyArray<ExistingPerson>),
	commandsFor: (plan, overrides, propertyOverrides) =>
		commandsFor(plan, overrides, propertyOverrides),
	summarize: (plan, overrides) => summarize(plan, overrides),
};

/** Register every built-in mapper. Idempotent — safe to call from app
 *  boot and from tests after `_resetImportRegistryForTests`. */
export function registerBuiltInImportMappers(): void {
	registerImportMapper(contactsImportMapper as TypeImportMapper);
}
