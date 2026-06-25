/**
 * @vitest-environment jsdom
 *
 * Renderer tests for the inspector "Collections" section (9.3.5.U).
 * Drives the bindings with vitest mocks so each side-effect (select,
 * toggle, add-request) is asserted independently from the data layer.
 */

import { describe, expect, it, vi } from "vitest";
import type { EntityRow, InMemoryEntities } from "../logic/in-memory-entities";
import type { List } from "../types/list";
import { ListSourceKind } from "../types/list-source";
import {
	INSPECTOR_ADD_TO_COLLECTION_TESTID,
	INSPECTOR_COLLECTIONS_TESTID,
	type InspectorCollectionsBindings,
	renderInspectorCollections,
} from "./inspector-collections";

const NOW = 1_700_000_000_000;

function entity(id: string, type: string, properties: Record<string, unknown> = {}): EntityRow {
	return { id, type, properties, createdAt: 0, updatedAt: 0, deletedAt: null };
}

function makeList(partial: Partial<List> & { id: string; name: string }): List {
	return {
		icon: null,
		description: "",
		source: null,
		members: { include: [], exclude: [] },
		views: [],
		defaultViewId: null,
		defaultTemplate: null,
		createdAt: 0,
		updatedAt: 0,
		...partial,
	};
}

const DB: InMemoryEntities = {
	entities: [
		entity("a", "io.test/Task/v1", { status: "Done" }),
		entity("b", "io.test/Task/v1", { status: "Open" }),
		entity("c", "io.test/Note/v1"),
	],
	links: [],
};

function makeBindings(
	overrides: Partial<InspectorCollectionsBindings> = {},
): InspectorCollectionsBindings {
	return {
		entityId: "a",
		lists: [],
		db: DB,
		isVaultDerivedListId: (id) => id.startsWith("list_vault_"),
		createListIcon: () => {
			const el = document.createElement("span");
			el.className = "test-icon-list";
			return el;
		},
		createCloseIcon: () => {
			const el = document.createElement("span");
			el.className = "test-icon-close";
			return el;
		},
		createPlusIcon: () => {
			const el = document.createElement("span");
			el.className = "test-icon-plus";
			return el;
		},
		onSelectList: vi.fn(),
		onToggleEntityInList: vi.fn(),
		onAddRequest: vi.fn(),
		...overrides,
	};
}

describe("renderInspectorCollections", () => {
	it("renders an empty state when the entity is in no collections", () => {
		const out = renderInspectorCollections(makeBindings({ lists: [] }));
		expect(out.dataset.testid).toBe(INSPECTOR_COLLECTIONS_TESTID);
		expect(out.querySelector("p")?.textContent).toBe("Not in any collection.");
		expect(out.querySelectorAll("li").length).toBe(0);
	});

	it("renders one row per containing collection with the right badge", () => {
		const tasks = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const manualWithA = makeList({
			id: "Pinned",
			name: "Pinned",
			source: null,
			members: { include: [{ entityId: "a", addedAt: NOW, by: "user" }], exclude: [] },
		});
		const out = renderInspectorCollections(makeBindings({ lists: [tasks, manualWithA] }));
		const rows = Array.from(out.querySelectorAll<HTMLElement>("li.db-inspector__collection-row"));
		expect(rows.length).toBe(2);
		expect(rows[0]?.dataset.listId).toBe("Tasks");
		expect(rows[0]?.dataset.kind).toBe("source");
		expect(rows[0]?.querySelector(".db-inspector__collection-badge")?.textContent).toBe("from query");
		expect(rows[1]?.dataset.listId).toBe("Pinned");
		expect(rows[1]?.dataset.kind).toBe("include");
		expect(rows[1]?.querySelector(".db-inspector__collection-badge")?.textContent).toBe("added");
	});

	it("clicking a row's name fires onSelectList with the list id", () => {
		const tasks = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const onSelectList = vi.fn();
		const out = renderInspectorCollections(makeBindings({ lists: [tasks], onSelectList }));
		out.querySelector<HTMLButtonElement>(".db-inspector__collection-open")?.click();
		expect(onSelectList).toHaveBeenCalledWith("Tasks");
	});

	it("clicking ✕ on a non-excluded row fires onToggleEntityInList with add=false", () => {
		const tasks = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const onToggle = vi.fn();
		const out = renderInspectorCollections(
			makeBindings({ lists: [tasks], onToggleEntityInList: onToggle }),
		);
		const remove = out.querySelector<HTMLButtonElement>(".db-inspector__collection-remove");
		expect(remove?.dataset.action).toBe("remove");
		remove?.click();
		expect(onToggle).toHaveBeenCalledWith("Tasks", false);
	});

	it("clicking ✕ on an excluded row fires onToggleEntityInList with add=true (un-exclude)", () => {
		const tasks = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
			members: { include: [], exclude: [{ entityId: "a", removedAt: NOW, by: "user" }] },
		});
		const onToggle = vi.fn();
		const out = renderInspectorCollections(
			makeBindings({ lists: [tasks], onToggleEntityInList: onToggle }),
		);
		const remove = out.querySelector<HTMLButtonElement>(".db-inspector__collection-remove");
		expect(remove?.dataset.action).toBe("add-back");
		remove?.click();
		expect(onToggle).toHaveBeenCalledWith("Tasks", true);
	});

	it("vault-derived list rows render WITHOUT a remove button (read-only)", () => {
		const vault = makeList({
			id: "list_vault_Task",
			name: "All Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const out = renderInspectorCollections(makeBindings({ lists: [vault] }));
		const row = out.querySelector<HTMLElement>("li.db-inspector__collection-row");
		expect(row?.querySelector(".db-inspector__collection-remove")).toBeNull();
	});

	it("'+ Add to collection' button calls onAddRequest with a viewport-relative point", () => {
		const onAdd = vi.fn();
		// Make at least one collection available so the button isn't disabled.
		const empty = makeList({ id: "Empty", name: "Empty", source: null });
		const out = renderInspectorCollections(makeBindings({ lists: [empty], onAddRequest: onAdd }));
		const btn = out.querySelector<HTMLButtonElement>(
			`[data-testid="${INSPECTOR_ADD_TO_COLLECTION_TESTID}"]`,
		);
		expect(btn).not.toBeNull();
		expect(btn?.disabled).toBe(false);
		btn?.click();
		expect(onAdd).toHaveBeenCalledTimes(1);
		const point = onAdd.mock.calls[0]?.[0];
		expect(typeof point.x).toBe("number");
		expect(typeof point.y).toBe("number");
	});

	it("'+ Add to collection' is disabled when there are no candidate lists", () => {
		const tasks = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		// `a` is already in Tasks via source; no other user list exists; picker
		// would be empty. The renderer disables the affordance instead of
		// popping an empty menu.
		const onAdd = vi.fn();
		const out = renderInspectorCollections(makeBindings({ lists: [tasks], onAddRequest: onAdd }));
		const btn = out.querySelector<HTMLButtonElement>(
			`[data-testid="${INSPECTOR_ADD_TO_COLLECTION_TESTID}"]`,
		);
		expect(btn?.disabled).toBe(true);
		btn?.click();
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("custom badge labels override the defaults (i18n hook)", () => {
		const tasks = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const out = renderInspectorCollections(makeBindings({ lists: [tasks] }), {
			source: "via query",
		} as Record<string, string>);
		expect(out.querySelector(".db-inspector__collection-badge")?.textContent).toBe("via query");
	});

	it("renders Excluded rows in input order alongside Source/Include rows", () => {
		const sourceMatch = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const excluded = makeList({
			id: "Hidden",
			name: "Hidden",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
			members: { include: [], exclude: [{ entityId: "a", removedAt: NOW, by: "user" }] },
		});
		const out = renderInspectorCollections(makeBindings({ lists: [excluded, sourceMatch] }));
		const rows = Array.from(out.querySelectorAll<HTMLElement>("li.db-inspector__collection-row"));
		expect(rows.map((r) => r.dataset.listId)).toEqual(["Hidden", "Tasks"]);
		expect(rows[0]?.dataset.kind).toBe("excluded");
		expect(rows[1]?.dataset.kind).toBe("source");
	});

	it("entity icons render through the provided createListIcon callback exactly once per row", () => {
		const tasks = makeList({
			id: "Tasks",
			name: "Tasks",
			source: { kind: ListSourceKind.ByType, types: ["io.test/Task/v1"] },
		});
		const createListIcon = vi.fn((_list: List, _size: number): HTMLElement => {
			const span = document.createElement("span");
			span.className = "test-icon-list";
			return span;
		});
		renderInspectorCollections(makeBindings({ lists: [tasks], createListIcon }));
		expect(createListIcon).toHaveBeenCalledTimes(1);
		const call = createListIcon.mock.calls[0];
		expect(call?.[1]).toBe(16);
	});
});
