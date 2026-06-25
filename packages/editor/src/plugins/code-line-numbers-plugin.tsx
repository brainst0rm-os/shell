/**
 * CodeLineNumbersPlugin — an optional left gutter of line numbers on every
 * code block (B11.4). A read-only overlay: it never touches the editor's node
 * tree or serialization, so it can't corrupt content (worst case is cosmetic
 * misalignment, which is why it's a separate toggle from highlighting).
 *
 * Editor-wide toggle (persisted in `localStorage`, like the wrap pref); the
 * code-block toolbar's "Lines" button flips it and dispatches
 * `LINE_NUMBERS_EVENT` so this always-mounted plugin re-reads + re-renders.
 * The root gains `notes--code-linenumbers` (CSS pads the block's left for the
 * gutter); each gutter is `position: fixed`, aligned to its block's content
 * top with a matching `line-height`, so the newline-separated numbers track
 * the code's lines (non-wrapped). Re-synced on editor update + scroll/resize.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useState } from "react";

export const LINE_NUMBERS_PREF_KEY = "notes.code.lineNumbers";
export const LINE_NUMBERS_ROOT_CLASS = "notes--code-linenumbers";
export const LINE_NUMBERS_EVENT = "notes:code-linenumbers-changed";

export function readLineNumbersPref(): boolean {
	try {
		return localStorage.getItem(LINE_NUMBERS_PREF_KEY) === "1";
	} catch {
		return false;
	}
}

export function persistLineNumbersPref(value: boolean): void {
	try {
		localStorage.setItem(LINE_NUMBERS_PREF_KEY, value ? "1" : "0");
	} catch {
		// localStorage unavailable — toggle still works for the session.
	}
}

type Gutter = { top: number; left: number; lineHeight: number; count: number };

function collectGutters(): Gutter[] {
	const out: Gutter[] = [];
	for (const el of Array.from(document.querySelectorAll<HTMLElement>(".notes__code"))) {
		const rect = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		const lineHeight = Number.parseFloat(cs.lineHeight) || 0;
		if (lineHeight <= 0) continue;
		const padTop = Number.parseFloat(cs.paddingTop) || 0;
		const padLeft = Number.parseFloat(cs.paddingLeft) || 0;
		// A trailing newline produces an empty last line; drop it so the count
		// matches the visible lines.
		const text = el.textContent ?? "";
		const normalized = text.endsWith("\n") ? text.slice(0, -1) : text;
		const count = normalized.length === 0 ? 1 : normalized.split("\n").length;
		out.push({ top: rect.top + padTop, left: rect.left + padLeft, lineHeight, count });
	}
	return out;
}

export function CodeLineNumbersPlugin() {
	const [editor] = useLexicalComposerContext();
	const [enabled, setEnabled] = useState(readLineNumbersPref);
	const [gutters, setGutters] = useState<Gutter[]>([]);

	// Reflect the pref onto the root (CSS pads the block's left) + follow toggles.
	useEffect(() => {
		const apply = () => {
			const next = readLineNumbersPref();
			setEnabled(next);
			editor.getRootElement()?.classList.toggle(LINE_NUMBERS_ROOT_CLASS, next);
		};
		apply();
		window.addEventListener(LINE_NUMBERS_EVENT, apply);
		return () => window.removeEventListener(LINE_NUMBERS_EVENT, apply);
	}, [editor]);

	// Recompute gutters on every editor update + scroll/resize while enabled.
	useEffect(() => {
		if (!enabled) {
			setGutters([]);
			return;
		}
		// Coalesce scroll/resize/update bursts into one rAF — a sync layout
		// sweep (querySelectorAll + getBoundingClientRect per block) on every
		// scroll frame would regress the editor-scroll budget.
		let raf = 0;
		const schedule = () => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				setGutters(collectGutters());
			});
		};
		setGutters(collectGutters());
		const off = editor.registerUpdateListener(schedule);
		window.addEventListener("scroll", schedule, true);
		window.addEventListener("resize", schedule);
		return () => {
			if (raf) cancelAnimationFrame(raf);
			off();
			window.removeEventListener("scroll", schedule, true);
			window.removeEventListener("resize", schedule);
		};
	}, [editor, enabled]);

	if (!enabled || gutters.length === 0) return null;
	return (
		<>
			{gutters.map((g, i) => (
				// Index-keyed (not position-keyed) so a scroll/resize that only
				// shifts coordinates updates style in place instead of remounting.
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: gutter list is positional + ephemeral; index is the stable identity.
					key={i}
					className="notes__code-gutter"
					aria-hidden="true"
					style={{ top: `${g.top}px`, left: `${g.left}px`, lineHeight: `${g.lineHeight}px` }}
				>
					{Array.from({ length: g.count }, (_, n) => `${n + 1}`).join("\n")}
				</div>
			))}
		</>
	);
}
