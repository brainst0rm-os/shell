/**
 * Synthetic large-document fixture for editor perf measurement (9.3.5.N5 →
 * 13.4a). Builds a deterministic block tree on the headless editor or
 * directly into a `Y.Doc` via `@lexical/yjs`'s shared root, so the same
 * shape can be measured both at the model layer (no DOM, no React) and on
 * the live `<BrainstormEditor>` surface (jsdom).
 *
 * The block mix and sizes mirror the "long but realistic" Notes document
 * pattern (mostly paragraphs, a few headings, a code block, a list) and
 * are bounded by `LARGE_DOC_PROFILES` so different rungs measure against
 * the same numbers — 13.4a's Phase-1 / Phase-2 before/after pass is the
 * primary consumer.
 *
 * Why a single fixture: the budget is the keystroke→paint number in
 * [docs/shell/13-frontend-stack.md §Performance budgets]; whichever
 * environment is measuring (headless, jsdom, eventually a real-browser
 * Playwright bench), the WORK being measured — a fixed-shape EditorState
 * tree — must be identical, else the numbers don't compare.
 */

import { $createCodeNode } from "@lexical/code";
import { $createListItemNode, $createListNode } from "@lexical/list";
import { $createHeadingNode } from "@lexical/rich-text";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";

/** A point in the perf-test grid. `blocks` is the top-level block count
 *  (which is what virtualization windows); `paragraphChars` controls how
 *  expensive each individual block's reconcile is. */
export type LargeDocProfile = {
	readonly id: string;
	readonly blocks: number;
	readonly paragraphChars: number;
};

/** Three points spanning "long Notes doc" to "stress doc". The 13.4
 *  stress target ([implementation-plan.md Stage 13.4]) is the 50MB Yjs
 *  doc; `stress` here approximates it at the block-count axis (DOM-size
 *  is what blows the keystroke budget, per [52]). `dogfood` is what
 *  Notes will realistically hit during beta; `large` is the threshold
 *  where Phase 1's `content-visibility` payoff should already show. */
export const LARGE_DOC_PROFILES = {
	dogfood: { id: "dogfood", blocks: 200, paragraphChars: 240 },
	large: { id: "large", blocks: 1000, paragraphChars: 240 },
	stress: { id: "stress", blocks: 5000, paragraphChars: 240 },
} as const satisfies Record<string, LargeDocProfile>;

const LOREM_SOURCE =
	"Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod " +
	"tempor incididunt ut labore et dolore magna aliqua ut enim ad minim " +
	"veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea " +
	"commodo consequat duis aute irure dolor in reprehenderit voluptate ";

function paragraphText(seed: number, chars: number): string {
	const start = (seed * 31) % LOREM_SOURCE.length;
	let out = "";
	let i = start;
	while (out.length < chars) {
		out += LOREM_SOURCE[i++ % LOREM_SOURCE.length];
	}
	return out.slice(0, chars);
}

/** Append `profile.blocks` synthetic top-level blocks to the editor's
 *  root in a single discrete transaction. Discrete is load-bearing for
 *  the perf test — async update + post-commit reconcile would race the
 *  measurement window. */
export function seedLargeDoc(editor: LexicalEditor, profile: LargeDocProfile): void {
	editor.update(
		() => {
			const root = $getRoot();
			root.clear();
			for (let i = 0; i < profile.blocks; i++) {
				const mod = i % 25;
				if (mod === 0) {
					const h = $createHeadingNode("h2");
					h.append($createTextNode(`Section ${(i / 25) | 0}`));
					root.append(h);
				} else if (mod === 5) {
					const code = $createCodeNode("ts");
					code.append($createTextNode(`const block${i} = ${i};`));
					root.append(code);
				} else if (mod === 10) {
					const list = $createListNode("bullet");
					for (let li = 0; li < 3; li++) {
						const item = $createListItemNode();
						item.append($createTextNode(`item ${i}.${li}`));
						list.append(item);
					}
					root.append(list);
				} else {
					const p = $createParagraphNode();
					p.append($createTextNode(paragraphText(i, profile.paragraphChars)));
					root.append(p);
				}
			}
		},
		{ discrete: true },
	);
}

/** Run `fn` `samples` times, return the min/median/max wall-clock ms.
 *  Min is the cleanest signal under jitter (GC pauses, OS scheduler) — we
 *  report all three so the budget call isn't on the worst-case noise
 *  spike alone. */
export type SampleStats = {
	readonly samples: number;
	readonly min: number;
	readonly median: number;
	readonly max: number;
};

export function timeSamples(fn: () => void, samples: number): SampleStats {
	const measurements: number[] = [];
	for (let i = 0; i < samples; i++) {
		const t0 = performance.now();
		fn();
		measurements.push(performance.now() - t0);
	}
	measurements.sort((a, b) => a - b);
	const len = measurements.length;
	const min = measurements[0] ?? 0;
	const max = measurements[len - 1] ?? 0;
	const median =
		len % 2 === 1
			? (measurements[len >> 1] ?? 0)
			: ((measurements[len / 2 - 1] ?? 0) + (measurements[len / 2] ?? 0)) / 2;
	return { samples: len, min, median, max };
}
