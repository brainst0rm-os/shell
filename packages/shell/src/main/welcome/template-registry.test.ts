import { describe, expect, it } from "vitest";
import { extractNoteReferences } from "../entities/extract-note-references";
import { parseTemplateManifest } from "./template-codec";
import { TEMPLATE_IDS, TEMPLATE_REGISTRY, templateById } from "./template-registry";

const NOW = 1_700_000_000_000;
const JOURNAL_ENTRY_TYPE = "io.brainstorm.journal/Entry/v1";
// The journal app surfaces an Entry only when its title is a strict canonical
// local-tz `YYYY-MM-DD` (parseJournalDateKey); a UTC-derived key would title
// the "today" entry with tomorrow's date near midnight in a negative-utc tz.
const CANONICAL_DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

describe("template registry", () => {
	it("has unique ids and resolves them", () => {
		expect(new Set(TEMPLATE_IDS).size).toBe(TEMPLATE_IDS.length);
		expect(TEMPLATE_IDS.length).toBe(7);
		for (const id of TEMPLATE_IDS) expect(templateById(id)?.id).toBe(id);
	});

	it("returns null for an unknown id (fail-closed import path)", () => {
		expect(templateById("does-not-exist")).toBeNull();
		expect(templateById("")).toBeNull();
	});
});

describe.each(TEMPLATE_REGISTRY)("template '$id'", (entry) => {
	it("is deterministic in `now` (byte-identical output)", () => {
		expect(JSON.stringify(entry.build(NOW))).toBe(JSON.stringify(entry.build(NOW)));
	});

	it("builds a manifest the codec accepts and round-trips", () => {
		const m = entry.build(NOW);
		expect(m.id).toBe(entry.id);
		expect(m.entities.length).toBeGreaterThan(0);
		expect(parseTemplateManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
	});

	it("display name/description match the built manifest (no gallery drift)", () => {
		const m = entry.build(NOW);
		expect(m.name).toBe(entry.name);
		expect(m.description).toBe(entry.description);
	});

	it("has unique entity ids", () => {
		const ids = entry.build(NOW).entities.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("every note-body mention targets an entity in the same manifest (no dangling refs)", () => {
		const m = entry.build(NOW);
		const ids = new Set(m.entities.map((e) => e.id));
		for (const ent of m.entities) {
			if (!ent.body) continue;
			for (const ref of extractNoteReferences(ent.body)) {
				expect(ids.has(ref.entityId)).toBe(true);
			}
		}
	});

	it("stamps the injected `now` onto every entity's createdAt", () => {
		const m = entry.build(NOW);
		for (const ent of m.entities) {
			// Journal entries intentionally backdate (yesterday); all others stamp `now`.
			expect(typeof ent.properties.createdAt).toBe("number");
			expect(ent.properties.createdAt as number).toBeLessThanOrEqual(NOW);
		}
	});

	it("titles any journal Entry with a distinct canonical local-tz date key", () => {
		const entries = entry.build(NOW).entities.filter((e) => e.type === JOURNAL_ENTRY_TYPE);
		const titles = entries.map((e) => e.properties.title);
		for (const title of titles) {
			expect(typeof title).toBe("string");
			expect(title as string).toMatch(CANONICAL_DAY_KEY);
		}
		expect(new Set(titles).size).toBe(titles.length);
	});
});
