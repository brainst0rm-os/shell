// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { mountComingSoon } from "./index";

describe("mountComingSoon", () => {
	let root: HTMLElement;

	beforeEach(() => {
		root = document.createElement("main");
	});

	it("renders the badge, title and blurb as text", () => {
		mountComingSoon(root, {
			badge: "Coming soon",
			title: "Theme Editor",
			blurb: "Edit and save theme components.",
		});

		expect(root.querySelector(".bs-coming-soon__badge")?.textContent).toBe("Coming soon");
		expect(root.querySelector(".bs-coming-soon__title")?.textContent).toBe("Theme Editor");
		expect(root.querySelector(".bs-coming-soon__blurb")?.textContent).toBe(
			"Edit and save theme components.",
		);
	});

	it("never interprets a label as markup", () => {
		mountComingSoon(root, {
			badge: "<b>x</b>",
			title: "<script>alert(1)</script>",
			blurb: "plain",
		});

		expect(root.querySelector("script")).toBeNull();
		expect(root.querySelector(".bs-coming-soon__title")?.textContent).toBe(
			"<script>alert(1)</script>",
		);
	});

	it("replaces prior content on re-mount instead of appending", () => {
		mountComingSoon(root, { badge: "a", title: "b", blurb: "c" });
		mountComingSoon(root, { badge: "a", title: "b", blurb: "c" });

		expect(root.querySelectorAll(".bs-coming-soon")).toHaveLength(1);
	});
});
