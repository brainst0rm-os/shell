/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";
import { isEditableElement } from "./is-editable";

afterEach(() => {
	document.body.innerHTML = "";
});

function mount(html: string): HTMLElement {
	document.body.innerHTML = html;
	const el = document.body.firstElementChild as HTMLElement;
	return el;
}

describe("isEditableElement — nullish + non-element", () => {
	it("returns false for null / undefined / window / document", () => {
		expect(isEditableElement(null)).toBe(false);
		expect(isEditableElement(undefined)).toBe(false);
		expect(isEditableElement(window as unknown as EventTarget)).toBe(false);
		expect(isEditableElement(document as unknown as EventTarget)).toBe(false);
	});
});

describe("isEditableElement — <input> types", () => {
	it("returns true for text-y input types", () => {
		for (const type of ["text", "search", "email", "url", "tel", "password", "number", "date"]) {
			expect(isEditableElement(mount(`<input type="${type}" />`))).toBe(true);
		}
	});

	it("returns true for an input with no type attribute (defaults to text)", () => {
		expect(isEditableElement(mount("<input />"))).toBe(true);
	});

	it("returns false for non-text input types", () => {
		for (const type of ["button", "checkbox", "radio", "submit", "reset", "range", "color"]) {
			expect(isEditableElement(mount(`<input type="${type}" />`))).toBe(false);
		}
	});
});

describe("isEditableElement — textarea", () => {
	it("returns true for a textarea", () => {
		expect(isEditableElement(mount("<textarea></textarea>"))).toBe(true);
	});
});

describe("isEditableElement — contenteditable", () => {
	it("returns true for contenteditable=true", () => {
		expect(isEditableElement(mount(`<div contenteditable="true">x</div>`))).toBe(true);
	});

	it("returns true for empty contenteditable (=== true per spec)", () => {
		expect(isEditableElement(mount(`<div contenteditable="">x</div>`))).toBe(true);
	});

	it("returns true for plaintext-only contenteditable", () => {
		expect(isEditableElement(mount(`<div contenteditable="plaintext-only">x</div>`))).toBe(true);
	});

	it("returns true for a descendant of contenteditable (inherited)", () => {
		document.body.innerHTML = `<div contenteditable="true"><span data-target>x</span></div>`;
		const span = document.querySelector("[data-target]") as HTMLElement;
		expect(isEditableElement(span)).toBe(true);
	});

	it("returns false for contenteditable=false", () => {
		expect(isEditableElement(mount(`<div contenteditable="false">x</div>`))).toBe(false);
	});

	it("returns false for a plain div", () => {
		expect(isEditableElement(mount("<div>x</div>"))).toBe(false);
	});
});
