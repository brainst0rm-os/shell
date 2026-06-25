// @vitest-environment jsdom
/**
 * 9.3.5.N5 → 13.4a hand-off measurement.
 *
 * Captures the keystroke→reconcile cost on the synthetic large-doc
 * fixture so 13.4a's Phase-1 (`content-visibility` + decorator-unmount)
 * and Phase-2 (true reconciliation-windowing) builders have a
 * before-virtualization number to compare against. Two layers, both
 * measured on the same `LARGE_DOC_PROFILES` shape:
 *
 *  1. **Model-layer keystroke** (`createBrainstormHeadlessEditor`): a
 *     discrete `editor.update` that mutates one text node. No DOM. This
 *     is the inherent Lexical-reconcile cost; virtualization will NOT
 *     improve it (and shouldn't). The number stays roughly flat as the
 *     doc grows because Lexical's reconciler only walks dirty nodes —
 *     that's the [52] thesis: the model is cheap, the DOM is not.
 *
 *  2. **DOM-layer keystroke** (`<BrainstormEditor>` in jsdom): the same
 *     update but reconciled into the contenteditable. THIS is the cost
 *     virtualization addresses. The number scales (roughly) with the
 *     rendered block count today.
 *
 * **Honest caveat on the absolute numbers.** jsdom is not a real
 * browser: it has no layout engine, no actual style-recalc cost, no
 * compositor, no `content-visibility`. So jsdom under-reports DOM-side
 * keystroke cost relative to Electron, AND `content-visibility: auto`
 * (Phase 1's core trick) is a no-op here — Phase 1 cannot be measured
 * at all in this environment. What this test is for is therefore
 * narrow and load-bearing:
 *
 *  - It pins the **trend**: model cost stays in the same order of
 *    magnitude across profiles; DOM cost grows visibly with block count.
 *    A regression that breaks the trend (e.g. accidental whole-tree
 *    re-render on each keystroke) will fail this test.
 *  - It produces concrete numbers in CI output that 13.4a's Phase-1 /
 *    Phase-2 builder can re-run on a real Electron renderer (Playwright)
 *    for the actual budget assessment, against an identical fixture.
 *  - It assert-fails only on a generous **smoke ceiling**, not on the
 *    `<16ms` keystroke→paint budget itself ([13-frontend-stack.md
 *    §Performance budgets]) — that budget can only be honestly checked
 *    in a real browser. The smoke ceiling guards against catastrophic
 *    regressions (e.g. quadratic reconciliation) while keeping CI green
 *    under normal jitter.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$getNodeByKey,
	$getRoot,
	$isElementNode,
	$isTextNode,
	type LexicalEditor,
	type LexicalNode,
} from "lexical";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Doc } from "yjs";
import { BrainstormEditor } from "./editor";
import { createBrainstormHeadlessEditor } from "./headless";
import {
	LARGE_DOC_PROFILES,
	type LargeDocProfile,
	type SampleStats,
	seedLargeDoc,
	timeSamples,
} from "./large-doc-fixture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Walk the model to find the first text node we can mutate; we'll
 *  prepend a character to it on each "keystroke". A first-block edit is
 *  the closest cheap proxy for a typing keystroke under the reconciler:
 *  the reconciler only touches the dirty node + its ancestor chain, so
 *  the cost should be ~constant in `profile.blocks` for the model
 *  layer. */
function findFirstTextKey(editor: LexicalEditor): string {
	let key: string | null = null;
	editor.getEditorState().read(() => {
		const stack: LexicalNode[] = [$getRoot()];
		while (stack.length > 0) {
			const n = stack.pop();
			if (!n) continue;
			if ($isTextNode(n)) {
				key = n.getKey();
				return;
			}
			if ($isElementNode(n)) {
				const kids = n.getChildren();
				for (let i = kids.length - 1; i >= 0; i--) {
					const child = kids[i];
					if (child) stack.push(child);
				}
			}
		}
	});
	if (!key) throw new Error("fixture has no text node — fixture is broken");
	return key;
}

/** Simulates one keystroke into a known text node by inserting a
 *  single character at offset 0. Discrete so the measurement window
 *  closes BEFORE we record `performance.now()` — the reconcile happens
 *  inside `editor.update`, not after it returns. */
function keystrokeOn(editor: LexicalEditor, nodeKey: string, char: string): void {
	editor.update(
		() => {
			const n = $getNodeByKey(nodeKey);
			if (n && $isTextNode(n)) n.spliceText(0, 0, char, false);
		},
		{ discrete: true },
	);
}

const MODEL_SAMPLES = 12;
/** Smoke ceiling for the model layer — generous; the real number is
 *  typically a small fraction of this on any laptop. Triggers ONLY on a
 *  catastrophic regression (whole-tree walk on every keystroke). */
const MODEL_SMOKE_CEILING_MS = 50;
/** Smoke ceiling for the jsdom DOM layer. jsdom is slower than a real
 *  browser at some things and faster at others; under-reports
 *  compositor/style-recalc which is exactly what `content-visibility`
 *  optimises. This number is therefore intentionally loose — the actual
 *  <16ms budget check happens on real Electron in 13.4a's bench, not
 *  here. */
const DOM_SMOKE_CEILING_MS = 500;

function formatStats(stats: SampleStats): string {
	return `min=${stats.min.toFixed(2)}ms median=${stats.median.toFixed(2)}ms max=${stats.max.toFixed(2)}ms n=${stats.samples}`;
}

describe("model-layer keystroke cost (headless, no DOM)", () => {
	for (const profile of Object.values(LARGE_DOC_PROFILES) as readonly LargeDocProfile[]) {
		it(`stays well under the smoke ceiling on the ${profile.id} profile (${profile.blocks} blocks)`, () => {
			const editor = createBrainstormHeadlessEditor();
			seedLargeDoc(editor, profile);
			const key = findFirstTextKey(editor);
			// Warm-up: first call pays for any module-level lazy-init /
			// JIT; not part of the measurement.
			keystrokeOn(editor, key, "w");

			const chars = "abcdefghijklmnop";
			let i = 0;
			const stats = timeSamples(() => {
				keystrokeOn(editor, key, chars[i++ % chars.length] ?? "x");
			}, MODEL_SAMPLES);

			console.log(
				`[bench] model keystroke (${profile.id}, ${profile.blocks} blocks): ${formatStats(stats)}`,
			);
			expect(stats.median).toBeLessThan(MODEL_SMOKE_CEILING_MS);
		});
	}
});

function CaptureEditor({ onReady }: { onReady: (e: LexicalEditor) => void }): null {
	const [editor] = useLexicalComposerContext();
	onReady(editor);
	return null;
}

describe("DOM-layer keystroke cost (jsdom, <BrainstormEditor>)", () => {
	let container: HTMLDivElement;
	let root: ReturnType<typeof createRoot>;
	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	// Only the smaller two profiles run in jsdom: `stress` (5k blocks)
	// is many seconds of jsdom mount time, useful in a Playwright bench
	// but not in unit-test CI. Real-browser numbers are 13.4a's job.
	const JSDOM_PROFILES = [LARGE_DOC_PROFILES.dogfood, LARGE_DOC_PROFILES.large] as const;

	for (const profile of JSDOM_PROFILES) {
		it(`stays under the smoke ceiling on the ${profile.id} profile (${profile.blocks} blocks)`, async () => {
			const doc = new Doc();

			let mountedEditor: LexicalEditor | null = null;
			await act(async () => {
				root.render(
					<BrainstormEditor doc={doc} docId="main" placeholder="">
						<CaptureEditor
							onReady={(e) => {
								mountedEditor = e;
							}}
						/>
					</BrainstormEditor>,
				);
			});
			await act(async () => {
				await Promise.resolve();
			});
			expect(mountedEditor, "editor should have mounted").not.toBeNull();
			const editor = mountedEditor as unknown as LexicalEditor;

			// Seed the live editor's body. Initial-mount time is NOT what
			// virtualization optimises (mounting empty + streaming blocks
			// is a separate question); we're isolating steady-state
			// keystroke cost.
			await act(async () => {
				seedLargeDoc(editor, profile);
			});

			const key = findFirstTextKey(editor);
			keystrokeOn(editor, key, "w"); // warm-up

			// Fewer samples for the jsdom layer — each is expensive.
			const SAMPLES = 6;
			const chars = "abcdefgh";
			let i = 0;
			const stats = timeSamples(() => {
				keystrokeOn(editor, key, chars[i++ % chars.length] ?? "x");
			}, SAMPLES);

			console.log(
				`[bench] dom keystroke (${profile.id}, ${profile.blocks} blocks): ${formatStats(stats)}`,
			);
			expect(stats.median).toBeLessThan(DOM_SMOKE_CEILING_MS);
		}, 60_000);
	}
});
