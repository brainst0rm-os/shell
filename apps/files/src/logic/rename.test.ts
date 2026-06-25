import { describe, expect, it } from "vitest";
import { IDLE_RENAME, RenameStatus, initialSelectionRange, renameReducer } from "./rename";

describe("renameReducer", () => {
	it("start → editing with draft = original", () => {
		const state = renameReducer(IDLE_RENAME, {
			kind: "start",
			entityId: "id",
			original: "name.txt",
		});
		expect(state).toEqual({
			status: RenameStatus.Editing,
			entityId: "id",
			original: "name.txt",
			draft: "name.txt",
		});
	});

	it("edit updates the draft only while editing", () => {
		const editing = renameReducer(IDLE_RENAME, {
			kind: "start",
			entityId: "id",
			original: "x",
		});
		const next = renameReducer(editing, { kind: "edit", draft: "y" });
		expect(next.status).toBe(RenameStatus.Editing);
		if (next.status !== RenameStatus.Editing) throw new Error("unreachable");
		expect(next.draft).toBe("y");
	});

	it("cancel returns to idle", () => {
		const editing = renameReducer(IDLE_RENAME, {
			kind: "start",
			entityId: "id",
			original: "x",
		});
		const idle = renameReducer(editing, { kind: "cancel" });
		expect(idle).toBe(IDLE_RENAME);
	});

	it("submit on an unchanged draft returns to idle (no commit)", () => {
		const editing = renameReducer(IDLE_RENAME, {
			kind: "start",
			entityId: "id",
			original: "x",
		});
		const next = renameReducer(editing, { kind: "submit" });
		expect(next).toBe(IDLE_RENAME);
	});

	it("submit on an empty draft returns to idle (rejects)", () => {
		let state = renameReducer(IDLE_RENAME, { kind: "start", entityId: "id", original: "x" });
		state = renameReducer(state, { kind: "edit", draft: "   " });
		expect(renameReducer(state, { kind: "submit" })).toBe(IDLE_RENAME);
	});

	it("submit on a real change moves to committing", () => {
		let state = renameReducer(IDLE_RENAME, { kind: "start", entityId: "id", original: "x" });
		state = renameReducer(state, { kind: "edit", draft: "y" });
		state = renameReducer(state, { kind: "submit" });
		expect(state.status).toBe(RenameStatus.Committing);
		if (state.status !== RenameStatus.Committing) throw new Error("unreachable");
		expect(state.draft).toBe("y");
	});

	it("collision while committing moves to confirming, preserving draft", () => {
		let state = renameReducer(IDLE_RENAME, { kind: "start", entityId: "id", original: "x" });
		state = renameReducer(state, { kind: "edit", draft: "y" });
		state = renameReducer(state, { kind: "submit" });
		state = renameReducer(state, { kind: "collision" });
		expect(state.status).toBe(RenameStatus.Confirming);
		if (state.status !== RenameStatus.Confirming) throw new Error("unreachable");
		expect(state.draft).toBe("y");
	});

	it("resolveCollision: cancel → idle", () => {
		let state = renameReducer(IDLE_RENAME, { kind: "start", entityId: "id", original: "x" });
		state = renameReducer(state, { kind: "edit", draft: "y" });
		state = renameReducer(state, { kind: "submit" });
		state = renameReducer(state, { kind: "collision" });
		state = renameReducer(state, { kind: "resolveCollision", decision: "cancel" });
		expect(state).toBe(IDLE_RENAME);
	});

	it("resolveCollision: renameAnyway → committing", () => {
		let state = renameReducer(IDLE_RENAME, { kind: "start", entityId: "id", original: "x" });
		state = renameReducer(state, { kind: "edit", draft: "y" });
		state = renameReducer(state, { kind: "submit" });
		state = renameReducer(state, { kind: "collision" });
		state = renameReducer(state, { kind: "resolveCollision", decision: "renameAnyway" });
		expect(state.status).toBe(RenameStatus.Committing);
	});

	it("committed returns to idle", () => {
		let state = renameReducer(IDLE_RENAME, { kind: "start", entityId: "id", original: "x" });
		state = renameReducer(state, { kind: "edit", draft: "y" });
		state = renameReducer(state, { kind: "submit" });
		state = renameReducer(state, { kind: "committed" });
		expect(state).toBe(IDLE_RENAME);
	});

	it("edit on idle state is a no-op", () => {
		const next = renameReducer(IDLE_RENAME, { kind: "edit", draft: "x" });
		expect(next).toBe(IDLE_RENAME);
	});
});

describe("initialSelectionRange", () => {
	it("selects everything for a folder-style name (no dot)", () => {
		expect(initialSelectionRange("Inbox")).toEqual({ start: 0, end: 5 });
	});

	it("selects the name sans extension for a file", () => {
		expect(initialSelectionRange("photo.png")).toEqual({ start: 0, end: 5 });
		expect(initialSelectionRange("report.final.pdf")).toEqual({ start: 0, end: 12 });
	});

	it("selects everything when the dot is leading (`.gitignore`)", () => {
		expect(initialSelectionRange(".gitignore")).toEqual({ start: 0, end: 10 });
	});

	it("selects everything when the dot is trailing (`name.`)", () => {
		expect(initialSelectionRange("name.")).toEqual({ start: 0, end: 5 });
	});
});
