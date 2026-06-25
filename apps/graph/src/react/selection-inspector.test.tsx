// @vitest-environment jsdom
/** SelectionInspector (9.13.11) — the editable inspector renders nothing for an
 *  empty selection, a count for a multi-selection, and the name + scalar
 *  property cells (excluding chrome keys) for a single selected node. */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityRow } from "../logic/in-memory-graph";
import { SelectionInspector } from "./selection-inspector";

const entity = (properties: Record<string, unknown>): EntityRow => ({
	id: "n1",
	type: "person/v1",
	properties,
	createdAt: 0,
	updatedAt: 0,
	deletedAt: null,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});
afterEach(() => {
	act(() => root.unmount());
	host.remove();
});

describe("SelectionInspector", () => {
	it("renders nothing when no node is selected", () => {
		act(() => root.render(<SelectionInspector selectedCount={0} entity={null} onCommit={vi.fn()} />));
		expect(host.querySelector('[data-testid="graph-inspector"]')).toBeNull();
	});

	it("shows a count summary for a multi-selection", () => {
		act(() => root.render(<SelectionInspector selectedCount={3} entity={null} onCommit={vi.fn()} />));
		expect(host.textContent).toContain("3 nodes selected");
	});

	it("renders editable cells (name + scalar props) for one selected node", () => {
		act(() =>
			root.render(
				<SelectionInspector
					selectedCount={1}
					entity={entity({ name: "Alice", city: "Berlin", body: "..." })}
					onCommit={vi.fn()}
				/>,
			),
		);
		const panel = host.querySelector('[data-testid="graph-inspector"]');
		expect(panel).not.toBeNull();
		// One row for the name field + one for the editable `city` scalar; `body`
		// is excluded (non-scalar chrome).
		expect(host.textContent).toContain("Name");
		expect(host.textContent).toContain("City");
		expect(host.textContent).not.toContain("Body");
	});
});
