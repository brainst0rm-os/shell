import { describe, expect, it } from "vitest";
import { extractNoteBodyText } from "./extract-note-text";

describe("extractNoteBodyText", () => {
	it("returns '' on null / undefined / non-object / wrong shape", () => {
		expect(extractNoteBodyText(null)).toBe("");
		expect(extractNoteBodyText(undefined)).toBe("");
		expect(extractNoteBodyText(42)).toBe("");
		expect(extractNoteBodyText([])).toBe("");
		expect(extractNoteBodyText({})).toBe("");
	});

	it("returns the trimmed + space-collapsed string for legacy string bodies", () => {
		expect(extractNoteBodyText("hello   world\n\tfoo")).toBe("hello world foo");
		expect(extractNoteBodyText("   ")).toBe("");
	});

	it("walks Lexical text nodes and joins them with single spaces", () => {
		const body = {
			root: {
				children: [
					{
						children: [
							{ type: "text", text: "Hello" },
							{ type: "text", text: "world" },
						],
					},
					{ children: [{ type: "text", text: "second paragraph" }] },
				],
			},
		};
		expect(extractNoteBodyText(body)).toBe("Hello world second paragraph");
	});

	it("includes mention chip labels (matches what the reader sees)", () => {
		const body = {
			root: {
				children: [
					{
						children: [
							{ type: "text", text: "see also" },
							{ type: "mention", label: "Project Roadmap", entityId: "ent_1" },
						],
					},
				],
			},
		};
		expect(extractNoteBodyText(body)).toBe("see also Project Roadmap");
	});

	it("ignores empty-text + non-text leaves and never throws on malformed nodes", () => {
		const body = {
			root: {
				children: [
					{ type: "text", text: "" },
					{ type: "text" },
					null,
					42,
					{ children: "not-an-array" },
					{ children: [{ type: "text", text: "kept" }] },
				],
			},
		};
		expect(extractNoteBodyText(body)).toBe("kept");
	});
});
