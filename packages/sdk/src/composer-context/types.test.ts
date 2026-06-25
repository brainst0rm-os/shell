import { AttachmentKind } from "@brainstorm/sdk-types";
import { describe, expect, it } from "vitest";
import { IconName } from "../icon";
import {
	ATTACHMENTS_MAX,
	attachmentIcon,
	attachmentLabel,
	candidateToAttachment,
	parseAttachments,
} from "./types";

describe("parseAttachments", () => {
	it("returns [] for non-arrays and drops malformed members", () => {
		expect(parseAttachments(null)).toEqual([]);
		expect(parseAttachments("nope")).toEqual([]);
		expect(parseAttachments([{ kind: "entity" }, "x", 42, { ref: "no-kind" }])).toEqual([]);
	});

	it("parses each kind, clamping the label and omitting absent fields", () => {
		const out = parseAttachments([
			{ kind: "entity", ref: "e1", label: "Spec", entityType: "Note/v1" },
			{ kind: "person", ref: "p1" },
			{ kind: "media", ref: "brainstorm://a", mediaType: "image/png", image: true, bytes: 9 },
			{ kind: "media", ref: "no-mime" },
		]);
		expect(out).toEqual([
			{ kind: AttachmentKind.Entity, ref: "e1", label: "Spec", entityType: "Note/v1" },
			{ kind: AttachmentKind.Person, ref: "p1" },
			{
				kind: AttachmentKind.Media,
				ref: "brainstorm://a",
				mediaType: "image/png",
				image: true,
				bytes: 9,
			},
		]);
	});

	it("caps the array length (render-DoS guard against a hostile peer blob)", () => {
		const huge = Array.from({ length: 5000 }, (_, i) => ({ kind: "entity", ref: `e${i}` }));
		expect(parseAttachments(huge)).toHaveLength(ATTACHMENTS_MAX);
	});

	it("drops a member whose ref is absurdly long, and clamps a long label", () => {
		const out = parseAttachments([
			{ kind: "entity", ref: "x".repeat(5000) },
			{ kind: "entity", ref: "ok", label: "y".repeat(5000) },
		]);
		expect(out).toHaveLength(1);
		expect(out[0]?.ref).toBe("ok");
		expect((out[0]?.label?.length ?? 0) <= 256).toBe(true);
	});
});

describe("candidateToAttachment", () => {
	it("maps a person candidate", () => {
		expect(candidateToAttachment({ id: "p1", kind: AttachmentKind.Person, label: "Sol" })).toEqual({
			kind: AttachmentKind.Person,
			ref: "p1",
			label: "Sol",
		});
	});

	it("maps an entity candidate with its type", () => {
		expect(
			candidateToAttachment({
				id: "e1",
				kind: AttachmentKind.Entity,
				label: "Doc",
				entityType: "Note/v1",
			}),
		).toEqual({ kind: AttachmentKind.Entity, ref: "e1", label: "Doc", entityType: "Note/v1" });
	});
});

describe("attachmentLabel + attachmentIcon", () => {
	it("falls back to the ref when no label", () => {
		expect(attachmentLabel({ kind: AttachmentKind.Entity, ref: "e1" })).toBe("e1");
		expect(attachmentLabel({ kind: AttachmentKind.Entity, ref: "e1", label: " Spec " })).toBe("Spec");
	});

	it("maps each kind to a glyph", () => {
		expect(attachmentIcon(AttachmentKind.Entity)).toBe(IconName.KindLink);
		expect(attachmentIcon(AttachmentKind.Person)).toBe(IconName.Entity);
		expect(attachmentIcon(AttachmentKind.Media)).toBe(IconName.KindFile);
	});
});
