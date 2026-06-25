import { describe, expect, it } from "vitest";
import {
	BLOCK_ID_PATTERN,
	formatBlockId,
	isBlockIdForApp,
	isValidBlockId,
	parseBlockId,
} from "./block-id";

describe("parseBlockId", () => {
	it("splits a well-formed id on its single separator", () => {
		expect(parseBlockId("io.example.notes/paragraph")).toEqual({
			appId: "io.example.notes",
			name: "paragraph",
		});
	});

	it("allows dots / dashes / underscores in both segments", () => {
		expect(parseBlockId("io.brainstorm.db-app/embedded_list-v1")).toEqual({
			appId: "io.brainstorm.db-app",
			name: "embedded_list-v1",
		});
	});

	it("rejects non-strings, empties, missing or extra separators, illegal chars", () => {
		for (const bad of [
			null,
			undefined,
			42,
			"",
			"noslash",
			"/leadingslash",
			"trailingslash/",
			"a/b/c",
			"app id/block",
			"app/bl ock",
			"app/блок",
		]) {
			expect(parseBlockId(bad)).toBeNull();
		}
	});
});

describe("isValidBlockId / isBlockIdForApp", () => {
	it("isValidBlockId mirrors parseBlockId success", () => {
		expect(isValidBlockId("a/b")).toBe(true);
		expect(isValidBlockId("a//b")).toBe(false);
		expect(isValidBlockId(123)).toBe(false);
	});

	it("isBlockIdForApp enforces the namespacing rule", () => {
		expect(isBlockIdForApp("io.example.notes/p", "io.example.notes")).toBe(true);
		expect(isBlockIdForApp("io.example.notes/p", "io.other.app")).toBe(false);
		// A prefix that isn't the exact appId segment must not pass.
		expect(isBlockIdForApp("io.example.notesX/p", "io.example.notes")).toBe(false);
		expect(isBlockIdForApp("bogus", "io.example.notes")).toBe(false);
	});
});

describe("formatBlockId", () => {
	it("round-trips with parseBlockId for valid parts", () => {
		const id = formatBlockId("io.example.app", "cool-block");
		expect(id).toBe("io.example.app/cool-block");
		expect(parseBlockId(id)).toEqual({ appId: "io.example.app", name: "cool-block" });
	});

	it("the exported pattern matches a canonical id", () => {
		expect(BLOCK_ID_PATTERN.test("io.example.app/block")).toBe(true);
	});
});
