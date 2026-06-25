// @vitest-environment jsdom
/**
 * F-237 guard — the Journal day-body mention chip must resolve a click to
 * the entity it references so the host can navigate. The chip carries
 * `data-entity-id` + `data-entity-type` but no own handler; the plugin's
 * `resolveMentionTarget` reads them off the nearest chip ancestor of the
 * click target (a click inside the chip's icon/label still resolves).
 */

import { describe, expect, it } from "vitest";
import { resolveMentionTarget } from "./mention-click-plugin";

function editorRoot(): HTMLElement {
	const root = document.createElement("div");
	root.className = "journal__entry-editor";
	return root;
}

function chip(root: HTMLElement, entityId: string, entityType?: string): HTMLElement {
	const span = document.createElement("span");
	span.setAttribute("data-entity-id", entityId);
	if (entityType) span.setAttribute("data-entity-type", entityType);
	const label = document.createElement("span");
	label.className = "notes__mention-label";
	label.textContent = "2026-05-14";
	span.appendChild(label);
	root.appendChild(span);
	return span;
}

describe("resolveMentionTarget", () => {
	it("resolves the entity id + type from a click inside the chip", () => {
		const root = editorRoot();
		const span = chip(root, "journal-2026-05-14", "io.brainstorm.journal/Entry/v1");
		const inner = span.querySelector(".notes__mention-label") as HTMLElement;
		expect(resolveMentionTarget(inner, root)).toEqual({
			entityId: "journal-2026-05-14",
			entityType: "io.brainstorm.journal/Entry/v1",
		});
	});

	it("omits entityType when the chip carries none", () => {
		const root = editorRoot();
		const span = chip(root, "journal-2026-05-15");
		expect(resolveMentionTarget(span, root)).toEqual({ entityId: "journal-2026-05-15" });
	});

	it("returns null when the click is not on a chip", () => {
		const root = editorRoot();
		const plain = document.createElement("p");
		plain.textContent = "no chip here";
		root.appendChild(plain);
		expect(resolveMentionTarget(plain, root)).toBeNull();
	});

	it("returns null for a chip outside the editor root", () => {
		const root = editorRoot();
		const stray = document.createElement("span");
		stray.setAttribute("data-entity-id", "elsewhere");
		document.body.appendChild(stray);
		expect(resolveMentionTarget(stray, root)).toBeNull();
		stray.remove();
	});
});
