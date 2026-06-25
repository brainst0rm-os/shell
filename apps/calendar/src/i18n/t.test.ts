import { describe, expect, it } from "vitest";
import { MANIFEST, t } from "./t";

describe("calendar i18n (createT-backed)", () => {
	it("resolves a plain key from the manifest", () => {
		expect(t("calendar.app.title")).toBe("Calendar");
		expect(t("calendar.header.newEvent")).toBe("New event");
	});

	it("interpolates {name} for the code-built birthday title", () => {
		expect(t("calendar.item.birthday", { name: "Mira" })).toBe("Mira's birthday");
		expect(t("calendar.item.birthday", { name: "A B" })).toBe("A B's birthday");
	});

	it("ships every detail-surface string the write path renders", () => {
		const required = [
			"calendar.detail.createTitle",
			"calendar.detail.editTitle",
			"calendar.detail.field.title",
			"calendar.detail.field.icon",
			"calendar.detail.save",
			"calendar.detail.delete",
			"calendar.detail.validation.endBeforeStart",
			"calendar.chrome.resizeSidebar",
			"calendar.event.moreActions",
		] as const;
		for (const key of required) {
			expect(MANIFEST[key]).toBeTruthy();
			expect(t(key)).not.toMatch(/^\[\?/);
		}
	});
});
