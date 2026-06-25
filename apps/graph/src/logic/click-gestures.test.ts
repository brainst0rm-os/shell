import { describe, expect, it } from "vitest";
import { NodeClickAction, singleClickAction } from "./click-gestures";

describe("singleClickAction", () => {
	it("selects the node when local-graph mode is off (global graph; dblclick opens)", () => {
		expect(singleClickAction({ pathMode: false, localMode: false, isCurrentRoot: false })).toBe(
			NodeClickAction.Select,
		);
	});

	it("re-roots the local view on click when local-graph mode is on", () => {
		expect(singleClickAction({ pathMode: false, localMode: true, isCurrentRoot: false })).toBe(
			NodeClickAction.Traverse,
		);
	});

	it("is a no-op on the current root (keeps double-click-to-open stable)", () => {
		expect(singleClickAction({ pathMode: false, localMode: true, isCurrentRoot: true })).toBe(
			NodeClickAction.None,
		);
	});

	it("path view always picks, regardless of mode", () => {
		expect(singleClickAction({ pathMode: true, localMode: false, isCurrentRoot: false })).toBe(
			NodeClickAction.PathPick,
		);
		expect(singleClickAction({ pathMode: true, localMode: true, isCurrentRoot: true })).toBe(
			NodeClickAction.PathPick,
		);
	});
});
