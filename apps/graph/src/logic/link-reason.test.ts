import { describe, expect, it } from "vitest";
import {
	LinkCategory,
	isDirectedCategory,
	linkCategory,
	linkCategoryLabel,
	linkReasonLabel,
	linkReasonShortLabel,
} from "./link-reason";

describe("linkCategory", () => {
	it("classifies note body links", () => {
		expect(linkCategory("io.brainstorm.notes/mention")).toBe(LinkCategory.BodyLink);
		expect(linkCategory("io.brainstorm.notes/link")).toBe(LinkCategory.BodyLink);
	});

	it("classifies shared-property links", () => {
		expect(linkCategory("brainstorm/shared-property/Person.company")).toBe(
			LinkCategory.SharedAttribute,
		);
		expect(linkCategory("brainstorm/shared-property/Bookmark.tags")).toBe(
			LinkCategory.SharedAttribute,
		);
	});

	it("treats everything else as a property reference", () => {
		expect(linkCategory("brainstorm/Task/in-project")).toBe(LinkCategory.PropertyReference);
		expect(linkCategory("brainstorm/Folder/contains")).toBe(LinkCategory.PropertyReference);
		expect(linkCategory("brainstorm/ref/io.x/Person/v1/manager")).toBe(
			LinkCategory.PropertyReference,
		);
	});
});

describe("isDirectedCategory", () => {
	it("marks references and body links directed, shared attributes undirected", () => {
		expect(isDirectedCategory(LinkCategory.BodyLink)).toBe(true);
		expect(isDirectedCategory(LinkCategory.PropertyReference)).toBe(true);
		expect(isDirectedCategory(LinkCategory.SharedAttribute)).toBe(false);
	});
});

describe("linkReasonShortLabel", () => {
	it("uses curated verbs for known link types", () => {
		expect(linkReasonShortLabel("io.brainstorm.notes/mention")).toBe("Mentions");
		expect(linkReasonShortLabel("io.brainstorm.notes/link")).toBe("Links to");
		expect(linkReasonShortLabel("brainstorm/Folder/contains")).toBe("Contains");
		expect(linkReasonShortLabel("brainstorm/Task/in-project")).toBe("In project");
	});

	it("names the shared attribute without its per-edge value", () => {
		expect(linkReasonShortLabel("brainstorm/shared-property/Person.company")).toBe("Shares company");
		expect(linkReasonShortLabel("brainstorm/shared-property/Bookmark.tags")).toBe("Shares tag");
	});

	it("humanizes an unknown property reference from its suffix", () => {
		expect(linkReasonShortLabel("brainstorm/ref/io.x/Person/v1/manager")).toBe("Manager");
	});
});

describe("linkReasonLabel", () => {
	it("appends the shared value when present", () => {
		expect(
			linkReasonLabel({ linkType: "brainstorm/shared-property/Person.company", detail: "Acme" }),
		).toBe("Shares company: Acme");
	});

	it("falls back to just the attribute when no value carried", () => {
		expect(linkReasonLabel({ linkType: "brainstorm/shared-property/Person.company" })).toBe(
			"Shares company",
		);
	});

	it("uses the source property name for a generic reference", () => {
		expect(
			linkReasonLabel({ linkType: "brainstorm/ref/io.x/Task/v1/assignee", detail: "Assignee" }),
		).toBe("Assignee");
	});

	it("uses curated verbs for known structured links", () => {
		expect(linkReasonLabel({ linkType: "brainstorm/Note/about" })).toBe("About");
		expect(linkReasonLabel({ linkType: "io.brainstorm.notes/mention" })).toBe("Mentions");
	});
});

describe("linkCategoryLabel", () => {
	it("names each category", () => {
		expect(linkCategoryLabel(LinkCategory.BodyLink)).toBe("Editor links");
		expect(linkCategoryLabel(LinkCategory.PropertyReference)).toBe("Property references");
		expect(linkCategoryLabel(LinkCategory.SharedAttribute)).toBe("Shared attributes");
	});
});
