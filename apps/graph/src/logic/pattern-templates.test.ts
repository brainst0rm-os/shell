import { describe, expect, it } from "vitest";
import type { InMemoryGraph } from "./in-memory-graph";
import {
	PATTERN_TEMPLATES,
	PatternTemplateId,
	presentTypeSet,
	templateAvailable,
} from "./pattern-templates";
import { validatePattern } from "./pattern-validate";

function db(types: string[]): InMemoryGraph {
	return {
		entities: types.map((type, i) => ({
			id: `e${i}`,
			type,
			properties: {},
			createdAt: 1,
			updatedAt: 1,
			deletedAt: null,
		})),
		links: [],
	};
}

describe("pattern templates (9.13.14)", () => {
	it("every template builds a pattern with no blocking validation issues", () => {
		// Empty-type subjects are an ADVISORY (intentional-but-expensive),
		// not a block — the Everything template deliberately binds any type.
		const ADVISORY = new Set(["subject-empty-types", "edge-empty-link-types"]);
		for (const template of PATTERN_TEMPLATES) {
			const result = validatePattern(template.build());
			const blocking = result.ok ? [] : result.issues.filter((i) => !ADVISORY.has(i.code));
			expect(blocking, template.id).toEqual([]);
		}
	});

	it("builds are fresh objects each call (no shared mutable state)", () => {
		const template = PATTERN_TEMPLATES.find((t) => t.id === PatternTemplateId.Work);
		const a = template?.build();
		const b = template?.build();
		expect(a).toEqual(b);
		expect(a).not.toBe(b);
	});

	it("Everything is always available; typed templates follow the vault", () => {
		const types = presentTypeSet(db(["brainstorm/Task/v1"]));
		const byId = new Map(PATTERN_TEMPLATES.map((t) => [t.id, t]));
		const everything = byId.get(PatternTemplateId.Everything);
		const work = byId.get(PatternTemplateId.Work);
		const people = byId.get(PatternTemplateId.People);
		if (!everything || !work || !people) throw new Error("missing template");
		expect(templateAvailable(everything, types)).toBe(true);
		expect(templateAvailable(work, types)).toBe(true);
		expect(templateAvailable(people, types)).toBe(false);
	});

	it("presentTypeSet excludes deleted entities", () => {
		const graph = db(["brainstorm/Task/v1"]);
		const first = graph.entities[0];
		if (!first) throw new Error("missing entity");
		first.deletedAt = 5;
		expect(presentTypeSet(graph).size).toBe(0);
	});
});
