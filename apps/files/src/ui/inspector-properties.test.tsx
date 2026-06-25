// @vitest-environment jsdom
/**
 * The Properties tab keys every row by render index, not by its label, so
 * two rows that humanize to the same label (a custom property keyed like a
 * system field, or two custom keys with the same humanized spelling) render
 * distinctly instead of colliding into a React duplicate-key warning +
 * unstable reconciliation (F-files inspector follow-up).
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FilesStore, InspectorTab } from "../store/use-files-store";
import { type Entity, FILE_TYPE } from "../types/entity";
import { Inspector } from "./inspector";

function fileEntity(properties: Record<string, unknown>): Entity {
	return {
		id: "file-1",
		type: FILE_TYPE,
		properties: { name: "Report.pdf", mime: "application/pdf", size: 2048, ...properties },
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
	};
}

function storeFor(focused: Entity): FilesStore {
	return {
		inspectorOpen: true,
		focused,
		inspectorTab: InspectorTab.Properties,
		setInspectorTab: () => {},
		toggleInspector: () => {},
	} as unknown as FilesStore;
}

type Harness = { container: HTMLElement; cleanup: () => void };

function mount(focused: Entity): Harness {
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	act(() => root.render(<Inspector store={storeFor(focused)} runtime={undefined} />));
	return {
		container,
		cleanup: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

describe("Properties tab row keys", () => {
	let h: Harness | null = null;
	afterEach(() => {
		h?.cleanup();
		h = null;
		document.body.innerHTML = "";
	});

	it("renders two custom properties that humanize to the same label as distinct rows without a duplicate-key warning", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		h = mount(fileEntity({ review_status: "approved", reviewStatus: "pending" }));
		const keys = Array.from(h.container.querySelectorAll<HTMLElement>(".bs-props__row-label")).map(
			(node) => node.textContent,
		);
		expect(keys.filter((label) => label === "Review status")).toHaveLength(2);
		const values = Array.from(h.container.querySelectorAll<HTMLElement>(".bs-props__row-value")).map(
			(node) => node.textContent,
		);
		expect(values).toContain("approved");
		expect(values).toContain("pending");
		const duplicateKeyWarning = errorSpy.mock.calls.some((args) =>
			args.some((arg) => typeof arg === "string" && arg.includes("same key")),
		);
		expect(duplicateKeyWarning).toBe(false);
		errorSpy.mockRestore();
	});

	it("renders an object-valued custom property as a compact key list", () => {
		h = mount(fileEntity({ dimensions: { width: 100, height: 200 } }));
		const values = Array.from(h.container.querySelectorAll<HTMLElement>(".bs-props__row-value")).map(
			(node) => node.textContent,
		);
		expect(values).toContain("{ width, height }");
	});
});
