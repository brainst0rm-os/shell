// @vitest-environment jsdom
/**
 * FileSidebar tests — the library pane lists previewable files, filters them
 * by name through the search box, highlights the active row, and opens a file
 * on click.
 */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PreviewFile } from "../demo/dataset";
import { flush, renderInto } from "../test/render";
import { FileSidebar } from "./file-sidebar";

function file(id: string, name: string): PreviewFile {
	return {
		id,
		info: { name, mime: "image/png", sizeBytes: null, modifiedAt: null },
		source: { kind: "url", url: `brainstorm://asset/${id}`, mime: "image/png", sizeBytes: null },
	};
}

const FILES = [file("a", "alpha.png"), file("b", "beta.pdf"), file("c", "gamma.png")];

function names(container: HTMLElement): string[] {
	return [...container.querySelectorAll(".preview__sidebar-name")].map((n) => n.textContent ?? "");
}

/** Set a controlled input's value the way React's change tracker expects
 *  (native setter + bubbled `input` event), so `onChange` actually fires. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
	await act(async () => {
		setter?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

describe("FileSidebar", () => {
	it("lists every file and marks the active row", async () => {
		const { container, unmount } = await renderInto(
			<FileSidebar files={FILES} activeId="b" onOpen={() => {}} />,
		);
		await flush();
		expect(names(container)).toEqual(["alpha.png", "beta.pdf", "gamma.png"]);
		const active = container.querySelector(".preview__sidebar-item--active .preview__sidebar-name");
		expect(active?.textContent).toBe("beta.pdf");
		await unmount();
	});

	it("filters the list by the search box, case-insensitively", async () => {
		const { container, unmount } = await renderInto(
			<FileSidebar files={FILES} activeId={null} onOpen={() => {}} />,
		);
		await flush();
		const input = container.querySelector<HTMLInputElement>(".preview__sidebar-input");
		if (!input) throw new Error("no search input");
		await typeInto(input, "PNG");
		expect(names(container)).toEqual(["alpha.png", "gamma.png"]);
		await unmount();
	});

	it("shows a no-matches message when the filter excludes everything", async () => {
		const { container, unmount } = await renderInto(
			<FileSidebar files={FILES} activeId={null} onOpen={() => {}} />,
		);
		await flush();
		const input = container.querySelector<HTMLInputElement>(".preview__sidebar-input");
		if (!input) throw new Error("no search input");
		await typeInto(input, "zzz");
		expect(container.querySelector(".preview__sidebar-list")).toBeNull();
		expect(container.querySelector(".preview__sidebar-empty")).not.toBeNull();
		await unmount();
	});

	it("opens the clicked file", async () => {
		const onOpen = vi.fn();
		const { container, unmount } = await renderInto(
			<FileSidebar files={FILES} activeId={null} onOpen={onOpen} />,
		);
		await flush();
		await act(async () => {
			container.querySelectorAll<HTMLButtonElement>(".preview__sidebar-item")[2]?.click();
		});
		expect(onOpen).toHaveBeenCalledWith(FILES[2]);
		await unmount();
	});

	it("renders an empty-state message with no files", async () => {
		const { container, unmount } = await renderInto(
			<FileSidebar files={[]} activeId={null} onOpen={() => {}} />,
		);
		await flush();
		expect(container.querySelector(".preview__sidebar-empty")).not.toBeNull();
		await unmount();
	});
});
