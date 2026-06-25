import { describe, expect, it } from "vitest";
import { BOOKMARKS_MESSAGES, t } from "./manifest";

describe("bookmarks i18n manifest", () => {
	it("has a non-empty English default for every key", () => {
		for (const [key, value] of Object.entries(BOOKMARKS_MESSAGES)) {
			expect(value, key).toBeTypeOf("string");
			expect(value.trim(), key).not.toBe("");
		}
	});

	it("resolves a plain key to its default", () => {
		expect(t("surface.inbox")).toBe("Inbox");
	});

	it("interpolates {tag} / {count} / {title} params", () => {
		expect(t("main.tag.named", { tag: "design" })).toBe("#design");
		expect(t("main.subtitle.many", { count: 4 })).toBe("4 bookmarks");
		expect(t("empty.tags.named", { tag: "x" })).toBe("No bookmarks tagged x.");
		expect(t("action.openLink", { title: "Docs" })).toBe("Open Docs in a new tab");
	});

	it("leaves an unknown placeholder token literal", () => {
		expect(t("main.subtitle.one")).toBe("1 bookmark");
	});
});
