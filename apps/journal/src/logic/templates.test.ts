import { describe, expect, it } from "vitest";
import { JOURNAL_TEMPLATE_SPECS, type JournalTemplate, templateToSeedState } from "./templates";

type Node = { type: string; tag?: string; children?: Node[]; text?: string };

function root(state: ReturnType<typeof templateToSeedState>): Node {
	return (state as unknown as { root: Node }).root;
}

describe("templateToSeedState", () => {
	it("emits a heading + empty paragraph per heading-only section", () => {
		const tpl: JournalTemplate = {
			id: "t",
			name: "T",
			sections: [{ heading: "What went well" }, { heading: "Tomorrow" }],
		};
		const children = root(templateToSeedState(tpl)).children ?? [];
		expect(children.map((c) => c.type)).toEqual(["heading", "paragraph", "heading", "paragraph"]);
		const firstHeading = children[0] as Node;
		expect(firstHeading.tag).toBe("h2");
		expect(firstHeading.children?.[0]?.text).toBe("What went well");
	});

	it("renders an optional prompt as a quote node before the writing paragraph", () => {
		const tpl: JournalTemplate = {
			id: "g",
			name: "Gratitude",
			sections: [{ heading: "Grateful for", prompt: "Three things…" }],
		};
		const children = root(templateToSeedState(tpl)).children ?? [];
		expect(children.map((c) => c.type)).toEqual(["heading", "quote", "paragraph"]);
		expect((children[1] as Node).children?.[0]?.text).toBe("Three things…");
	});

	it("supports a prompt-only (free-write) section with no heading", () => {
		const tpl: JournalTemplate = {
			id: "f",
			name: "Free write",
			sections: [{ heading: "", prompt: "Whatever's on your mind…" }],
		};
		const children = root(templateToSeedState(tpl)).children ?? [];
		expect(children.map((c) => c.type)).toEqual(["quote", "paragraph"]);
	});

	it("falls back to a single empty paragraph for an empty template", () => {
		const children = root(templateToSeedState({ id: "x", name: "X", sections: [] })).children ?? [];
		expect(children).toHaveLength(1);
		expect(children[0]?.type).toBe("paragraph");
	});
});

describe("JOURNAL_TEMPLATE_SPECS", () => {
	it("declares stable ids and at least one section each", () => {
		const ids = JOURNAL_TEMPLATE_SPECS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const spec of JOURNAL_TEMPLATE_SPECS) {
			expect(spec.sections.length).toBeGreaterThan(0);
			expect(spec.nameKey).toBeTruthy();
		}
	});

	it("is frozen", () => {
		expect(Object.isFrozen(JOURNAL_TEMPLATE_SPECS)).toBe(true);
	});
});
