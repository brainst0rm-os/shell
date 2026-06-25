/**
 * @vitest-environment jsdom
 *
 * Regression: the popover footer is a sibling of the form, so a
 * `type="submit"` button inside the footer never fires the form's
 * submit event. Clicking Save (and Save-in-edit-tags) must still
 * persist via `onSave`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bookmark } from "../types/bookmark";
import { openComposeBookmark, openEditTags } from "./compose-bookmark";

function clickSubmit(): void {
	const btn = document.querySelector<HTMLButtonElement>(
		'.bs-popover__footer button[data-bs-primary=""]',
	);
	if (!btn) throw new Error("submit button not found");
	btn.click();
}

function setInput(label: string, value: string): void {
	const rows = document.querySelectorAll<HTMLLabelElement>(".bookmarks__form-row");
	for (const row of rows) {
		if (row.textContent?.includes(label)) {
			const input = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(
				".bookmarks__form-input",
			);
			if (input) {
				input.value = value;
				return;
			}
		}
	}
	throw new Error(`input for ${label} not found`);
}

afterEach(() => {
	document.body.replaceChildren();
});

describe("openComposeBookmark", () => {
	it("clicking Save calls onSave with the composed bookmark", () => {
		const onSave = vi.fn<(b: Bookmark) => void>();
		openComposeBookmark({
			existing: [],
			idFactory: () => "bm-test",
			now: () => 1,
			onSave,
		});
		setInput("URL", "https://example.com/article");
		clickSubmit();
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave.mock.calls[0]?.[0]?.url).toContain("example.com");
	});

	it("download-content checkbox defaults checked and reports through onSave", () => {
		const onSave = vi.fn<(b: Bookmark, opts: { downloadContent: boolean }) => void>();
		openComposeBookmark({
			existing: [],
			idFactory: () => "bm-test",
			now: () => 1,
			onSave,
		});
		const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
		expect(checkbox?.checked).toBe(true);
		setInput("URL", "https://example.com/article");
		clickSubmit();
		expect(onSave.mock.calls[0]?.[1]).toEqual({ downloadContent: true });
	});

	it("honours the per-vault default (9.18.5) and reports an opt-back-in", () => {
		const onSave = vi.fn<(b: Bookmark, opts: { downloadContent: boolean }) => void>();
		openComposeBookmark({
			existing: [],
			idFactory: () => "bm-test",
			now: () => 1,
			downloadContentDefault: false,
			onSave,
		});
		const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
		expect(checkbox?.checked).toBe(false);
		// User flips it back on for this save — onSave carries the live value.
		if (!checkbox) throw new Error("checkbox not found");
		checkbox.click();
		setInput("URL", "https://example.com/article");
		clickSubmit();
		expect(onSave.mock.calls[0]?.[1]).toEqual({ downloadContent: true });
	});
});

describe("openEditTags", () => {
	it("clicking Save calls onSave with the tag-edited bookmark", () => {
		const bookmark: Bookmark = {
			id: "bm-1",
			url: "https://example.com/",
			title: "Example",
			faviconUrl: null,
			coverImageUrl: null,
			tags: [],
			savedAt: 1,
			readAt: null,
			archivedAt: null,
			colorHint: null,
			createdAt: 1,
			updatedAt: 1,
		};
		const onSave = vi.fn<(b: Bookmark) => void>();
		openEditTags({ bookmark, now: () => 2, onSave });
		setInput("Tags", "alpha, beta");
		clickSubmit();
		expect(onSave).toHaveBeenCalledTimes(1);
		expect(onSave.mock.calls[0]?.[0]?.tags).toEqual(["alpha", "beta"]);
	});
});
