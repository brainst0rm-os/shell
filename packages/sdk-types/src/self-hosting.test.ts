import { describe, expect, it } from "vitest";
import {
	DESIGN_DOC_CATEGORIES,
	DESIGN_DOC_JSON_SCHEMA,
	DesignDocCategory,
	type DesignDocEntity,
	ITERATION_JSON_SCHEMA,
	ITERATION_STATUSES,
	type IterationEntity,
	IterationStatus,
	MILESTONE_JSON_SCHEMA,
	OPEN_QUESTION_JSON_SCHEMA,
	OPEN_QUESTION_STATUSES,
	type OpenQuestionEntity,
	OpenQuestionStatus,
	RELEASE_JSON_SCHEMA,
	SELF_HOSTING_ENTITY_TYPES,
	SELF_HOSTING_JSON_SCHEMAS,
	STAGE_JSON_SCHEMA,
	SelfHostingEntityType,
	type StageEntity,
	isDesignDocCategory,
	isIterationStatus,
	isOpenQuestionStatus,
	isSelfHostingEntityType,
} from "./self-hosting";

describe("self-hosting frozen enums", () => {
	it("freezes ITERATION_STATUSES with the full set of values", () => {
		expect(Object.isFrozen(ITERATION_STATUSES)).toBe(true);
		expect(ITERATION_STATUSES).toEqual([
			IterationStatus.Done,
			IterationStatus.Partial,
			IterationStatus.Pending,
			IterationStatus.Reverted,
			IterationStatus.Unknown,
		]);
	});

	it("freezes OPEN_QUESTION_STATUSES with both values", () => {
		expect(Object.isFrozen(OPEN_QUESTION_STATUSES)).toBe(true);
		expect(OPEN_QUESTION_STATUSES).toEqual([OpenQuestionStatus.Open, OpenQuestionStatus.Resolved]);
	});

	it("freezes DESIGN_DOC_CATEGORIES with every documented section", () => {
		expect(Object.isFrozen(DESIGN_DOC_CATEGORIES)).toBe(true);
		expect(DESIGN_DOC_CATEGORIES).toHaveLength(9);
		expect(DESIGN_DOC_CATEGORIES).toContain(DesignDocCategory.Foundations);
		expect(DESIGN_DOC_CATEGORIES).toContain(DesignDocCategory.Platform);
		expect(DESIGN_DOC_CATEGORIES).toContain(DesignDocCategory.Reference);
	});

	it("freezes SELF_HOSTING_ENTITY_TYPES with every type id (incl. the PM spine)", () => {
		expect(Object.isFrozen(SELF_HOSTING_ENTITY_TYPES)).toBe(true);
		expect(SELF_HOSTING_ENTITY_TYPES).toEqual([
			SelfHostingEntityType.Iteration,
			SelfHostingEntityType.OpenQuestion,
			SelfHostingEntityType.Stage,
			SelfHostingEntityType.DesignDoc,
			SelfHostingEntityType.Release,
			SelfHostingEntityType.Milestone,
		]);
	});

	it("Release/Milestone -> brainstorm/<Type>/v1 and are schema-registered", () => {
		expect(SelfHostingEntityType.Release).toBe("brainstorm/Release/v1");
		expect(SelfHostingEntityType.Milestone).toBe("brainstorm/Milestone/v1");
		expect(SELF_HOSTING_JSON_SCHEMAS[SelfHostingEntityType.Release]).toBe(RELEASE_JSON_SCHEMA);
		expect(SELF_HOSTING_JSON_SCHEMAS[SelfHostingEntityType.Milestone]).toBe(MILESTONE_JSON_SCHEMA);
	});
});

describe("self-hosting entity-type ids use brainstorm/<Type>/v1 shape", () => {
	it("Iteration -> brainstorm/Iteration/v1", () => {
		expect(SelfHostingEntityType.Iteration).toBe("brainstorm/Iteration/v1");
	});
	it("OpenQuestion -> brainstorm/OpenQuestion/v1", () => {
		expect(SelfHostingEntityType.OpenQuestion).toBe("brainstorm/OpenQuestion/v1");
	});
	it("Stage -> brainstorm/Stage/v1", () => {
		expect(SelfHostingEntityType.Stage).toBe("brainstorm/Stage/v1");
	});
	it("DesignDoc -> brainstorm/DesignDoc/v1", () => {
		expect(SelfHostingEntityType.DesignDoc).toBe("brainstorm/DesignDoc/v1");
	});
});

describe("self-hosting predicates", () => {
	it("isIterationStatus accepts every enum value and rejects others", () => {
		for (const s of ITERATION_STATUSES) expect(isIterationStatus(s)).toBe(true);
		expect(isIterationStatus("nope")).toBe(false);
		expect(isIterationStatus(undefined)).toBe(false);
		expect(isIterationStatus(123)).toBe(false);
	});

	it("isOpenQuestionStatus accepts open / resolved and rejects others", () => {
		expect(isOpenQuestionStatus("open")).toBe(true);
		expect(isOpenQuestionStatus("resolved")).toBe(true);
		expect(isOpenQuestionStatus("pending")).toBe(false);
		expect(isOpenQuestionStatus(null)).toBe(false);
	});

	it("isDesignDocCategory accepts each frozen category", () => {
		for (const c of DESIGN_DOC_CATEGORIES) expect(isDesignDocCategory(c)).toBe(true);
		expect(isDesignDocCategory("monorepo")).toBe(false);
	});

	it("isSelfHostingEntityType accepts the four type ids", () => {
		expect(isSelfHostingEntityType(SelfHostingEntityType.Iteration)).toBe(true);
		expect(isSelfHostingEntityType(SelfHostingEntityType.OpenQuestion)).toBe(true);
		expect(isSelfHostingEntityType(SelfHostingEntityType.Stage)).toBe(true);
		expect(isSelfHostingEntityType(SelfHostingEntityType.DesignDoc)).toBe(true);
		expect(isSelfHostingEntityType("brainstorm/Note/v1")).toBe(false);
	});
});

describe("self-hosting JSON schemas", () => {
	it("registers all four schemas in SELF_HOSTING_JSON_SCHEMAS keyed by type id", () => {
		expect(Object.isFrozen(SELF_HOSTING_JSON_SCHEMAS)).toBe(true);
		expect(SELF_HOSTING_JSON_SCHEMAS[SelfHostingEntityType.Iteration]).toBe(ITERATION_JSON_SCHEMA);
		expect(SELF_HOSTING_JSON_SCHEMAS[SelfHostingEntityType.OpenQuestion]).toBe(
			OPEN_QUESTION_JSON_SCHEMA,
		);
		expect(SELF_HOSTING_JSON_SCHEMAS[SelfHostingEntityType.Stage]).toBe(STAGE_JSON_SCHEMA);
		expect(SELF_HOSTING_JSON_SCHEMAS[SelfHostingEntityType.DesignDoc]).toBe(DESIGN_DOC_JSON_SCHEMA);
	});

	it("each schema has a $id matching its type and required fields", () => {
		const i = ITERATION_JSON_SCHEMA as { $id: string; required: string[] };
		expect(i.$id).toBe(SelfHostingEntityType.Iteration);
		expect(i.required).toContain("code");
		expect(i.required).toContain("stageId");
		expect(i.required).toContain("status");

		const oq = OPEN_QUESTION_JSON_SCHEMA as { $id: string; required: string[] };
		expect(oq.$id).toBe(SelfHostingEntityType.OpenQuestion);
		expect(oq.required).toContain("number");
		expect(oq.required).toContain("section");

		const st = STAGE_JSON_SCHEMA as { $id: string; required: string[] };
		expect(st.$id).toBe(SelfHostingEntityType.Stage);
		expect(st.required).toContain("stageId");

		const dd = DESIGN_DOC_JSON_SCHEMA as { $id: string; required: string[] };
		expect(dd.$id).toBe(SelfHostingEntityType.DesignDoc);
		expect(dd.required).toContain("path");
		expect(dd.required).toContain("docNumber");
		expect(dd.required).toContain("category");
	});
});

describe("structural shape — types compile and accept canonical values", () => {
	it("IterationEntity accepts a canonical Stage 9 row", () => {
		const value: IterationEntity = {
			id: "iter-9-14-1-5",
			code: "9.14.1.5",
			stageId: "9",
			title: "Tasks preview drop",
			status: IterationStatus.Done,
			summary: "Full Inbox/Today/Upcoming/Project UX over 4 projects + 32 tasks.",
			completedAt: Date.UTC(2026, 4, 14),
			resolvedOQs: ["OQ-TK-1", "OQ-TK-2"],
			createdAt: 1,
			updatedAt: 2,
		};
		expect(value.status).toBe(IterationStatus.Done);
		expect(value.resolvedOQs).toEqual(["OQ-TK-1", "OQ-TK-2"]);
	});

	it("OpenQuestionEntity accepts both open and resolved shapes", () => {
		const open: OpenQuestionEntity = {
			id: "oq-72",
			code: "OQ-72",
			number: 72,
			section: "General",
			title: "Cross-platform build matrix",
			status: OpenQuestionStatus.Open,
			where: "Stage 13",
			question: "Linux distribution coverage?",
			resolution: null,
			resolutionRef: null,
			createdAt: 1,
			updatedAt: 2,
		};
		const resolved: OpenQuestionEntity = {
			...open,
			id: "oq-34",
			code: "OQ-34",
			number: 34,
			status: OpenQuestionStatus.Resolved,
			resolution: "Picked SQLCipher",
			resolutionRef: "implementation-plan Stage 3b",
		};
		expect(open.status).toBe(OpenQuestionStatus.Open);
		expect(resolved.status).toBe(OpenQuestionStatus.Resolved);
	});

	it("StageEntity allows null goal + ownerDomain", () => {
		const value: StageEntity = {
			id: "stage-9",
			stageId: "9",
			heading: "Stage 9 — Rich text, Block Protocol, first-party apps",
			status: IterationStatus.Partial,
			goal: null,
			ownerDomain: null,
			iterationCodes: ["9.1", "9.2", "9.3"],
			exitCriteria: ["Editor renders blocks", "Entities service online"],
			createdAt: 1,
			updatedAt: 2,
		};
		expect(value.iterationCodes).toHaveLength(3);
	});

	it("DesignDocEntity carries cross-doc references and governs iterations", () => {
		const value: DesignDocEntity = {
			id: "doc-49-self-hosting",
			path: "docs/foundations/49-self-hosting.md",
			slug: "self-hosting",
			category: DesignDocCategory.Foundations,
			docNumber: 49,
			title: "Self-hosting",
			excerpt: "Brainstorm is the IDE for building Brainstorm.",
			referencedDocs: ["doc-00-index", "doc-35-code-conventions"],
			governingIterations: ["SH-1", "SH-2", "SH-3", "SH-4", "SH-5"],
			createdAt: 1,
			updatedAt: 2,
		};
		expect(value.docNumber).toBe(49);
		expect(value.governingIterations).toContain("SH-5");
	});
});
