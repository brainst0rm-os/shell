// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ToggleCollapseStore } from "./toggle-collapse-store";

afterEach(() => localStorage.clear());

describe("ToggleCollapseStore (localStorage-backed)", () => {
	it("defaults to expanded for an unseen block", () => {
		const store = new ToggleCollapseStore("doc-1");
		expect(store.isCollapsed("blk-a")).toBe(false);
	});

	it("persists collapsed state under a per-doc key and reads it back in a fresh instance", () => {
		new ToggleCollapseStore("doc-1").setCollapsed("blk-a", true);
		expect(new ToggleCollapseStore("doc-1").isCollapsed("blk-a")).toBe(true);
	});

	it("namespaces by document — a collapse in one doc doesn't leak into another", () => {
		new ToggleCollapseStore("doc-1").setCollapsed("blk-a", true);
		expect(new ToggleCollapseStore("doc-2").isCollapsed("blk-a")).toBe(false);
	});

	it("toggle() flips and returns the new collapsed state", () => {
		const store = new ToggleCollapseStore("doc-1");
		expect(store.toggle("blk-a")).toBe(true);
		expect(store.isCollapsed("blk-a")).toBe(true);
		expect(store.toggle("blk-a")).toBe(false);
		expect(store.isCollapsed("blk-a")).toBe(false);
	});

	it("removes the storage key entirely once the last collapsed id is cleared", () => {
		const store = new ToggleCollapseStore("doc-1");
		store.setCollapsed("blk-a", true);
		expect(localStorage.getItem("bs.toggle.doc-1")).not.toBeNull();
		store.setCollapsed("blk-a", false);
		expect(localStorage.getItem("bs.toggle.doc-1")).toBeNull();
	});

	it("recovers gracefully from a corrupt stored value", () => {
		localStorage.setItem("bs.toggle.doc-1", "{not json");
		const store = new ToggleCollapseStore("doc-1");
		expect(store.isCollapsed("blk-a")).toBe(false);
		store.setCollapsed("blk-a", true);
		expect(store.isCollapsed("blk-a")).toBe(true);
	});
});

describe("ToggleCollapseStore (in-memory fallback)", () => {
	it("tracks state within the instance when no docId is given (session-only)", () => {
		const store = new ToggleCollapseStore();
		store.setCollapsed("blk-a", true);
		expect(store.isCollapsed("blk-a")).toBe(true);
		// Nothing leaks to localStorage in the no-doc case.
		expect(localStorage.length).toBe(0);
	});

	it("does not share state across separate session instances", () => {
		new ToggleCollapseStore().setCollapsed("blk-a", true);
		expect(new ToggleCollapseStore().isCollapsed("blk-a")).toBe(false);
	});
});
