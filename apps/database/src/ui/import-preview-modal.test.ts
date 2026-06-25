/**
 * @vitest-environment jsdom
 *
 * 9.12.16-UI slice 2 — the per-row preview-and-override modal. Drives the
 * real DOM the dialog builds (jsdom has no `showModal`, which the modal
 * guards) and asserts the three slice-2 affordances reach the resolved
 * decision: per-row action toggle, inline field edit, and the matched-row
 * diff render.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { PersonDraft } from "../logic/contact-import";
import { ImportAction, planImport, summarize } from "../logic/contact-import-plan";
import { buildPreviewRows } from "../logic/import-preview";
import { humanize } from "./humanize";
import { openImportPreviewModal } from "./import-flow";

function draft(over: Partial<PersonDraft> & { name: string }): PersonDraft {
	return { ...over };
}

function dialog(): HTMLDialogElement {
	const el = document.querySelector("dialog.db-import-modal");
	if (!el) throw new Error("modal not mounted");
	return el as HTMLDialogElement;
}

function fire(el: HTMLElement, type: string): void {
	el.dispatchEvent(new Event(type, { bubbles: true }));
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("openImportPreviewModal", () => {
	it("renders one row per preview row with the default summary + button", async () => {
		const plan = planImport([draft({ name: "Ada" }), draft({ name: "Grace" })], []);
		const rows = buildPreviewRows(plan, [], humanize);
		const promise = openImportPreviewModal({
			filename: "people.vcf",
			targetTypeLabel: "Contacts",
			rows,
			summarize: (o) => summarize(plan, o),
		});

		expect(dialog().querySelectorAll(".db-import-row")).toHaveLength(2);
		expect(dialog().querySelector(".db-import-modal__summary")?.textContent).toBe("2 new");
		const importBtn = dialog().querySelector(".db-import-modal__import") as HTMLButtonElement;
		expect(importBtn.textContent).toBe("Import 2");
		expect(importBtn.disabled).toBe(false);

		dialog().querySelector<HTMLButtonElement>(".db-import-modal__cancel")?.click();
		const decision = await promise;
		expect(decision.confirmed).toBe(false);
	});

	it("toggling a row to Skip updates the summary, button, and resolved overrides", async () => {
		const plan = planImport([draft({ name: "Ada" }), draft({ name: "Grace" })], []);
		const rows = buildPreviewRows(plan, [], humanize);
		const promise = openImportPreviewModal({
			filename: "people.vcf",
			targetTypeLabel: "Contacts",
			rows,
			summarize: (o) => summarize(plan, o),
		});

		const firstAction = dialog().querySelector<HTMLButtonElement>(".db-import-row__action");
		// Unmatched row: New → Skip on first click.
		firstAction?.click();
		expect(firstAction?.textContent).toBe("Skip");
		expect(dialog().querySelector(".db-import-modal__summary")?.textContent).toBe("1 new · 1 skip");
		expect(dialog().querySelector(".db-import-modal__import")?.textContent).toBe("Import 1");

		dialog().querySelector<HTMLButtonElement>(".db-import-modal__import")?.click();
		const decision = await promise;
		expect(decision.confirmed).toBe(true);
		expect(decision.actionOverrides).toEqual({ 0: ImportAction.Skip });
	});

	it("editing the title + a field collects property overrides for the row", async () => {
		const plan = planImport([draft({ name: "Ada", company: "Old" })], []);
		const rows = buildPreviewRows(plan, [], humanize);
		const promise = openImportPreviewModal({
			filename: "people.vcf",
			targetTypeLabel: "Contacts",
			rows,
			summarize: (o) => summarize(plan, o),
		});

		const titleInput = dialog().querySelector<HTMLInputElement>(".db-import-row__title");
		if (!titleInput) throw new Error("no title input");
		titleInput.value = "Ada Lovelace";
		fire(titleInput, "input");

		// Open the disclosure, edit the company field.
		dialog().querySelector<HTMLButtonElement>(".db-import-row__expand")?.click();
		const companyInput = [
			...dialog().querySelectorAll<HTMLInputElement>(".db-import-row__fields input"),
		].find((i) => i.getAttribute("aria-label") === humanize("company"));
		if (!companyInput) throw new Error("no company input");
		companyInput.value = "BU";
		fire(companyInput, "input");

		dialog().querySelector<HTMLButtonElement>(".db-import-modal__import")?.click();
		const decision = await promise;
		expect(decision.confirmed).toBe(true);
		expect(decision.propertyOverrides[0]).toMatchObject({ name: "Ada Lovelace", company: "BU" });
	});

	it("renders the existing→merged diff for a matched row", async () => {
		const existing = [{ id: "p1", properties: { name: "Ada", email: ["ada@old.com"] } }];
		const plan = planImport([draft({ name: "Ada", email: ["ada@new.com"] })], existing);
		const rows = buildPreviewRows(plan, existing, humanize);
		openImportPreviewModal({
			filename: "people.vcf",
			targetTypeLabel: "Contacts",
			rows,
			summarize: (o) => summarize(plan, o),
		});

		expect(dialog().querySelector(".db-import-row__action")?.textContent).toBe("Merge");
		dialog().querySelector<HTMLButtonElement>(".db-import-row__expand")?.click();
		const changed = dialog().querySelector('.db-import-row__diff-line[data-changed="true"]');
		expect(changed?.querySelector(".db-import-row__diff-after")?.textContent).toContain(
			"ada@new.com",
		);
	});
});
