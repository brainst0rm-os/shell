import { describe, expect, it } from "vitest";
import { NoteReferenceKind, extractNoteReferences } from "../entities/extract-note-references";
import {
	WELCOME_ID_PREFIX,
	WELCOME_SEED_VERSION,
	WelcomeEntityType,
	buildWelcomeStarterSet,
} from "./welcome-content";

const NOW = 1_700_000_000_000;

describe("buildWelcomeStarterSet", () => {
	it("is deterministic in `now` (byte-identical output)", () => {
		expect(buildWelcomeStarterSet(NOW)).toEqual(buildWelcomeStarterSet(NOW));
	});

	it("seed version is a positive integer", () => {
		expect(Number.isInteger(WELCOME_SEED_VERSION)).toBe(true);
		expect(WELCOME_SEED_VERSION).toBeGreaterThan(0);
	});

	it("includes one entity per core bundled app", () => {
		const types = buildWelcomeStarterSet(NOW).map((e) => e.type);
		// The hub note (Note) plus a dated Journal entry, plus one each of the
		// other kinds.
		expect(types.filter((t) => t === WelcomeEntityType.Note).length).toBe(1);
		expect(types.filter((t) => t === WelcomeEntityType.JournalEntry).length).toBe(1);
		for (const t of [
			WelcomeEntityType.Task,
			WelcomeEntityType.Project,
			WelcomeEntityType.Folder,
			WelcomeEntityType.Event,
			WelcomeEntityType.Whiteboard,
			WelcomeEntityType.Bookmark,
		]) {
			expect(types).toContain(t);
		}
	});

	it("every id is prefixed and unique", () => {
		const ids = buildWelcomeStarterSet(NOW).map((e) => e.id);
		expect(ids.every((id) => id.startsWith(WELCOME_ID_PREFIX))).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("the hub note is first so the dashboard opens onto it", () => {
		const [first] = buildWelcomeStarterSet(NOW);
		expect(first?.type).toBe(WelcomeEntityType.Note);
		expect(first?.properties.title).toBe("Welcome to Brainstorm");
	});

	it("the hub note cross-links to every other starter entity (graph-paintable)", () => {
		const set = buildWelcomeStarterSet(NOW);
		const [hub, ...rest] = set;
		expect(hub?.body).toBeDefined();
		// Use the REAL shell parser the vault-entities snapshot uses to derive edges.
		const refs = extractNoteReferences(hub?.body);
		const mentioned = new Set(refs.map((r) => r.entityId));
		// Every non-note "leaf" app entity is reachable from the hub.
		for (const e of rest) {
			expect(mentioned.has(e.id)).toBe(true);
		}
		expect(refs.every((r) => r.kind === NoteReferenceKind.Mention)).toBe(true);
	});

	it("no mention targets a non-existent entity (no dangling edges)", () => {
		const set = buildWelcomeStarterSet(NOW);
		const ids = new Set(set.map((e) => e.id));
		for (const entity of set) {
			if (!entity.body) continue;
			for (const ref of extractNoteReferences(entity.body)) {
				expect(ids.has(ref.entityId)).toBe(true);
			}
		}
	});

	it("mention nodes carry the target's real entity type", () => {
		const set = buildWelcomeStarterSet(NOW);
		const byId = new Map(set.map((e) => [e.id, e]));
		for (const entity of set) {
			if (!entity.body) continue;
			for (const ref of extractNoteReferences(entity.body)) {
				expect(ref.entityType).toBe(byId.get(ref.entityId)?.type);
			}
		}
	});

	it("non-editor entities carry no body; text-editor entities carry a body", () => {
		const EDITOR_TYPES = new Set([WelcomeEntityType.Note, WelcomeEntityType.JournalEntry]);
		for (const e of buildWelcomeStarterSet(NOW)) {
			if (EDITOR_TYPES.has(e.type)) expect(e.body).toBeDefined();
			else expect(e.body).toBeUndefined();
		}
	});

	it("stamps the provided `now` onto every entity's timestamps", () => {
		for (const e of buildWelcomeStarterSet(NOW)) {
			expect(e.properties.createdAt).toBe(NOW);
			expect(e.properties.updatedAt).toBe(NOW);
		}
	});
});
