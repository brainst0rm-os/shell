/**
 * Fixture sanity: the synthetic large doc has the shape every perf test
 * downstream expects (top-level block count matches, every profile
 * round-trips through `toJSON`). Not a perf test — measurement lives in
 * `keystroke-paint.bench.test.ts` so a noisy CI run doesn't break the
 * shape contract.
 */

import { $getRoot } from "lexical";
import { describe, expect, it } from "vitest";
import { createBrainstormHeadlessEditor } from "./headless";
import { LARGE_DOC_PROFILES, seedLargeDoc, timeSamples } from "./large-doc-fixture";

describe("large-doc fixture", () => {
	for (const profile of Object.values(LARGE_DOC_PROFILES)) {
		it(`seeds ${profile.id} with ${profile.blocks} top-level blocks`, () => {
			const editor = createBrainstormHeadlessEditor();
			seedLargeDoc(editor, profile);
			editor.getEditorState().read(() => {
				expect($getRoot().getChildrenSize()).toBe(profile.blocks);
			});
		});
	}

	it("round-trips serialised state on the dogfood profile", () => {
		const editor = createBrainstormHeadlessEditor();
		seedLargeDoc(editor, LARGE_DOC_PROFILES.dogfood);
		const first = editor.getEditorState().toJSON();
		const parsed = editor.parseEditorState(JSON.stringify(first));
		editor.setEditorState(parsed);
		const second = editor.getEditorState().toJSON();
		expect(second).toEqual(first);
	});

	it("timeSamples returns ordered min ≤ median ≤ max", () => {
		const stats = timeSamples(() => {
			let s = 0;
			for (let i = 0; i < 1000; i++) s += i;
			expect(s).toBeGreaterThan(0);
		}, 5);
		expect(stats.samples).toBe(5);
		expect(stats.min).toBeLessThanOrEqual(stats.median);
		expect(stats.median).toBeLessThanOrEqual(stats.max);
	});
});
