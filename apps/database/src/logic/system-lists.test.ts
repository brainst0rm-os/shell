import { describe, expect, it } from "vitest";
import type { List } from "../types/list";
import { ListSourceKind } from "../types/list-source";
import {
	SidebarRowKind,
	isSystemList,
	partitionSidebarLists,
	sidebarNavRows,
} from "./system-lists";

const isVaultDerived = (id: string): boolean => id.startsWith("list_vault_");

function list(id: string, name: string, types: string[] | null): List {
	return {
		id,
		name,
		description: "",
		icon: null,
		source: types ? { kind: ListSourceKind.ByType, types } : null,
		members: { include: [], exclude: [] },
		views: [],
		defaultViewId: null,
		defaultTemplate: null,
		createdAt: 0,
		updatedAt: 0,
	} as unknown as List;
}

const NOTES = list("list_vault_note", "Notes", ["brainstorm/Note/v1"]);
const TASKS = list("list_vault_task", "Tasks", ["brainstorm/Task/v1"]);
const HISTORIES = list("list_vault_bh", "BrowsingHistories", ["brainstorm/BrowsingHistory/v1"]);
const TRIGGERS = list("list_vault_trigger", "Triggers", ["brainstorm/Trigger/v1"]);
const LIST_VIEWS = list("list_vault_lv", "ListViews", ["brainstorm/ListView/v1"]);
const CRM = list("list_user_crm", "Clients", null);

describe("isSystemList", () => {
	it("classifies a vault-derived type-list over an infrastructure type", () => {
		expect(isSystemList(HISTORIES, isVaultDerived)).toBe(true);
		expect(isSystemList(TRIGGERS, isVaultDerived)).toBe(true);
		expect(isSystemList(LIST_VIEWS, isVaultDerived)).toBe(true);
	});

	it("keeps user-content type-lists out", () => {
		expect(isSystemList(NOTES, isVaultDerived)).toBe(false);
		expect(isSystemList(TASKS, isVaultDerived)).toBe(false);
	});

	it("a user-created collection is NEVER system — even over a system type", () => {
		const userOverSystem = list("list_user_x", "My triggers", ["brainstorm/Trigger/v1"]);
		expect(isSystemList(userOverSystem, isVaultDerived)).toBe(false);
		expect(isSystemList(CRM, isVaultDerived)).toBe(false);
	});

	it("a mixed-type list stays user-facing when any type is user content", () => {
		const mixed = list("list_vault_mix", "Mixed", ["brainstorm/Trigger/v1", "brainstorm/Note/v1"]);
		expect(isSystemList(mixed, isVaultDerived)).toBe(false);
	});
});

describe("partitionSidebarLists", () => {
	it("splits system type-lists out, preserving order in both halves", () => {
		const { user, system } = partitionSidebarLists(
			[NOTES, HISTORIES, TASKS, TRIGGERS, CRM],
			isVaultDerived,
		);
		expect(user.map((l) => l.id)).toEqual([NOTES.id, TASKS.id, CRM.id]);
		expect(system.map((l) => l.id)).toEqual([HISTORIES.id, TRIGGERS.id]);
	});
});

describe("sidebarNavRows", () => {
	it("renders user rows only when nothing is system (no header)", () => {
		const rows = sidebarNavRows([NOTES, CRM], { systemOpen: false, isVaultDerived });
		expect(rows.map((r) => r.kind)).toEqual([SidebarRowKind.List, SidebarRowKind.List]);
	});

	it("collapsed: user rows then a closed header, system rows hidden", () => {
		const rows = sidebarNavRows([NOTES, HISTORIES, TRIGGERS, CRM], {
			systemOpen: false,
			isVaultDerived,
		});
		expect(rows.map((r) => r.kind)).toEqual([
			SidebarRowKind.List,
			SidebarRowKind.List,
			SidebarRowKind.SystemHeader,
		]);
		const header = rows[2];
		if (header?.kind !== SidebarRowKind.SystemHeader) throw new Error("expected header");
		expect(header.count).toBe(2);
		expect(header.open).toBe(false);
	});

	it("open: the system rows render BELOW the header, below every user row", () => {
		const rows = sidebarNavRows([HISTORIES, NOTES, CRM, TRIGGERS], {
			systemOpen: true,
			isVaultDerived,
		});
		expect(rows.map((r) => (r.kind === SidebarRowKind.List ? r.list.id : "header"))).toEqual([
			NOTES.id,
			CRM.id,
			"header",
			HISTORIES.id,
			TRIGGERS.id,
		]);
	});
});
