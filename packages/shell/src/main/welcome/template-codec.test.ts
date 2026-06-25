import { describe, expect, it } from "vitest";
import {
	TEMPLATE_MANIFEST_VERSION,
	type TemplateEntity,
	buildTemplateManifest,
	parseTemplateManifest,
} from "./template-codec";

const body = { root: { type: "root", children: [] } } as never;

const ENTITIES: TemplateEntity[] = [
	{ id: "t_task", type: "brainstorm/Task/v1", properties: { name: "Do a thing", status: "todo" } },
	{ id: "t_note", type: "io.brainstorm.notes/Note/v1", properties: { title: "Welcome" }, body },
];

describe("buildTemplateManifest", () => {
	it("stamps the current version + carries id/name/description/entities", () => {
		const m = buildTemplateManifest({
			id: "study",
			name: "Study",
			description: "For students",
			entities: ENTITIES,
		});
		expect(m.version).toBe(TEMPLATE_MANIFEST_VERSION);
		expect(m).toMatchObject({ id: "study", name: "Study", description: "For students" });
		expect(m.entities.map((e) => e.id)).toEqual(["t_task", "t_note"]);
		expect(m.entities[1]?.body).toBe(body);
	});

	it("defaults a missing description to '' and omits an absent body", () => {
		const m = buildTemplateManifest({
			id: "x",
			name: "X",
			entities: [ENTITIES[0] as TemplateEntity],
		});
		expect(m.description).toBe("");
		expect(m.entities[0]).not.toHaveProperty("body");
	});

	it("round-trips through parse", () => {
		const m = buildTemplateManifest({ id: "study", name: "Study", entities: ENTITIES });
		expect(parseTemplateManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
	});
});

describe("parseTemplateManifest", () => {
	const ok = { id: "x", name: "X", entities: [{ id: "e1", type: "T/v1", properties: { a: 1 } }] };

	it("parses a well-formed manifest", () => {
		expect(parseTemplateManifest(ok)).toEqual({
			version: 1,
			id: "x",
			name: "X",
			description: "",
			entities: [{ id: "e1", type: "T/v1", properties: { a: 1 } }],
		});
	});

	it("returns null for non-objects / missing id or name / no entities", () => {
		expect(parseTemplateManifest(null)).toBeNull();
		expect(parseTemplateManifest("nope")).toBeNull();
		expect(parseTemplateManifest({ name: "X", entities: ok.entities })).toBeNull(); // no id
		expect(parseTemplateManifest({ id: "x", entities: ok.entities })).toBeNull(); // no name
		expect(parseTemplateManifest({ id: "x", name: "X", entities: [] })).toBeNull(); // empty
	});

	it("drops malformed entities but keeps the valid ones", () => {
		const parsed = parseTemplateManifest({
			id: "x",
			name: "X",
			entities: [
				{ id: "good", type: "T/v1", properties: { a: 1 } },
				{ id: "", type: "T/v1" }, // blank id → dropped
				{ type: "T/v1" }, // no id → dropped
				{ id: "noType" }, // no type → dropped
				"garbage",
			],
		});
		expect(parsed?.entities.map((e) => e.id)).toEqual(["good"]);
	});

	it("coerces a missing properties bag to {} and drops a non-object body", () => {
		const parsed = parseTemplateManifest({
			id: "x",
			name: "X",
			entities: [{ id: "e1", type: "T/v1", body: "not an object" }],
		});
		expect(parsed?.entities[0]).toEqual({ id: "e1", type: "T/v1", properties: {} });
	});

	it("keeps a well-formed body (root present)", () => {
		const parsed = parseTemplateManifest({
			id: "x",
			name: "X",
			entities: [{ id: "e1", type: "T/v1", properties: {}, body: { root: { children: [] } } }],
		});
		expect(parsed?.entities[0]?.body).toEqual({ root: { children: [] } });
	});

	it("is forward-version tolerant (a future version still parses)", () => {
		const parsed = parseTemplateManifest({ ...ok, version: 99 });
		expect(parsed?.version).toBe(99);
	});

	it("defaults a missing/invalid version to 1", () => {
		expect(parseTemplateManifest({ ...ok, version: 0 })?.version).toBe(1);
		expect(parseTemplateManifest({ ...ok, version: "x" })?.version).toBe(1);
	});
});
