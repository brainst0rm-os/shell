import { describe, expect, it } from "vitest";
import { extractNoteReferences } from "../../entities/extract-note-references";
import { parseTemplateManifest } from "../template-codec";
import {
	PROJECT_MANAGEMENT_TEMPLATE_ID,
	buildProjectManagementTemplate,
} from "./project-management";

const NOW = 1_700_000_000_000;

describe("buildProjectManagementTemplate", () => {
	it("is deterministic in `now` (byte-identical output)", () => {
		expect(JSON.stringify(buildProjectManagementTemplate(NOW))).toBe(
			JSON.stringify(buildProjectManagementTemplate(NOW)),
		);
	});

	it("produces a manifest the codec accepts and round-trips", () => {
		const m = buildProjectManagementTemplate(NOW);
		expect(m.id).toBe(PROJECT_MANAGEMENT_TEMPLATE_ID);
		expect(parseTemplateManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
	});

	it("covers the core app types (Project / Task / Note / Event)", () => {
		const types = new Set(buildProjectManagementTemplate(NOW).entities.map((e) => e.type));
		expect(types).toContain("brainstorm/Project/v1");
		expect(types).toContain("brainstorm/Task/v1");
		expect(types).toContain("io.brainstorm.notes/Note/v1");
		expect(types).toContain("brainstorm/Event/v1");
	});

	it("has stable, unique entity ids", () => {
		const ids = buildProjectManagementTemplate(NOW).entities.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.every((id) => id.startsWith("tmpl-pm-"))).toBe(true);
	});

	it("the kickoff note's body cross-links other template entities (graph-paintable, no dangling refs)", () => {
		const m = buildProjectManagementTemplate(NOW);
		const note = m.entities.find((e) => e.type === "io.brainstorm.notes/Note/v1");
		expect(note?.body).toBeDefined();
		const refs = extractNoteReferences(note?.body);
		expect(refs.length).toBeGreaterThan(0);
		// Every mention target is another entity in this template (no dangling).
		const ids = new Set(m.entities.map((e) => e.id));
		for (const ref of refs) expect(ids.has(ref.entityId)).toBe(true);
		// At least the project + the first two tasks are linked.
		const linked = new Set(refs.map((r) => r.entityId));
		expect(linked.has("tmpl-pm-project")).toBe(true);
		expect(linked.has("tmpl-pm-task-charter")).toBe(true);
	});

	it("stamps the injected `now` onto created/updated + the event start", () => {
		const m = buildProjectManagementTemplate(NOW);
		const event = m.entities.find((e) => e.type === "brainstorm/Event/v1");
		expect(event?.properties.createdAt).toBe(NOW);
		expect(event?.properties.start).toBe(NOW + 86_400_000);
	});
});
