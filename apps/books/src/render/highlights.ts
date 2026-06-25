/**
 * DOM glue for highlight authoring (9.21.4) over the throwaway preview
 * reader. Self-contained render surface (allowed under the reactivity
 * rule). Three pieces:
 *
 *   - `paintFragment` — render a page fragment's text with the overlapping
 *     highlights painted as `<mark>` spans (plain text outside them).
 *   - `readFragmentSelection` — map the live DOM `Selection` over the
 *     painted page back to the pure `FragmentSelection` shape (which
 *     fragment + intra-fragment offset), so the locator math stays in
 *     logic/selection-locator.ts.
 *   - `buildHighlightsPanel` / `buildSelectionMenu` — the list panel + the
 *     select-to-highlight colour/note menu, both pure-DOM builders.
 *
 * THROWAWAY with the reader (9.21.2); the pure model under logic/ stays.
 */

import { type BooksI18nKey, plural, t } from "../i18n";
import { type HighlightSpan, highlightSpanInFragment } from "../logic/highlight-store";
import type { PageFragment } from "../logic/page-slice";
import type { FragmentPoint, FragmentSelection } from "../logic/selection-locator";
import { type Highlight, HighlightColor } from "../types/highlight";
import type { LocatorRange } from "../types/locator";

export const COLOR_ORDER: readonly HighlightColor[] = [
	HighlightColor.Yellow,
	HighlightColor.Green,
	HighlightColor.Blue,
	HighlightColor.Pink,
	HighlightColor.Purple,
];

const COLOR_LABELS: Record<HighlightColor, BooksI18nKey> = {
	[HighlightColor.Yellow]: "highlight.color.yellow",
	[HighlightColor.Green]: "highlight.color.green",
	[HighlightColor.Blue]: "highlight.color.blue",
	[HighlightColor.Pink]: "highlight.color.pink",
	[HighlightColor.Purple]: "highlight.color.purple",
};

/** Marks the index of a painted fragment element so a DOM selection can be
 *  resolved back to a `FragmentPoint`. */
const FRAGMENT_INDEX_ATTR = "data-fragment-index";

/** Render one page fragment's text into `host`, splitting it into plain text
 *  runs and `<mark>` runs for the highlights that overlap it. `fragmentIndex`
 *  is stamped so the selection reader can recover it. */
export function paintFragment(
	host: HTMLElement,
	fragment: PageFragment,
	fragmentIndex: number,
	highlights: readonly Highlight[],
	onClickHighlight: (id: string) => void,
): void {
	host.setAttribute(FRAGMENT_INDEX_ATTR, String(fragmentIndex));
	const spans = spansForFragment(fragment, highlights);
	if (spans.length === 0) {
		host.textContent = fragment.text;
		return;
	}
	host.replaceChildren();
	let cursor = 0;
	for (const span of spans) {
		if (span.from > cursor) {
			host.append(document.createTextNode(fragment.text.slice(cursor, span.from)));
		}
		const mark = document.createElement("mark");
		mark.className = `books__mark books__mark--${span.color}`;
		mark.dataset.highlightId = span.highlightId;
		mark.textContent = fragment.text.slice(span.from, span.to);
		mark.addEventListener("click", (event) => {
			event.stopPropagation();
			onClickHighlight(span.highlightId);
		});
		host.append(mark);
		cursor = span.to;
	}
	if (cursor < fragment.text.length) {
		host.append(document.createTextNode(fragment.text.slice(cursor)));
	}
}

/** The highlight spans that paint within a fragment, left-to-right, clipped
 *  to its text and de-overlapped (later highlights yield to earlier ones at
 *  a shared offset so the runs never cross). */
function spansForFragment(
	fragment: PageFragment,
	highlights: readonly Highlight[],
): HighlightSpan[] {
	const raw: HighlightSpan[] = [];
	for (const highlight of highlights) {
		const span = highlightSpanInFragment(highlight, fragment.spineOffset, fragment.text.length);
		if (span) raw.push(span);
	}
	raw.sort((a, b) => a.from - b.from || a.to - b.to);
	const out: HighlightSpan[] = [];
	let cursor = 0;
	for (const span of raw) {
		const from = Math.max(span.from, cursor);
		if (from >= span.to) continue;
		out.push({ ...span, from });
		cursor = span.to;
	}
	return out;
}

/** Map the live DOM `Selection` to the pure `FragmentSelection`. Returns
 *  `null` when the selection is empty, collapsed, or lands outside the
 *  painted page fragments. Each painted fragment element carries the
 *  `data-fragment-index` stamp; an offset within a fragment that has nested
 *  `<mark>` children is summed across the preceding child text. */
export function readFragmentSelection(
	pageEl: HTMLElement,
	selection: Selection | null,
): FragmentSelection | null {
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
	const anchor = pointFor(pageEl, selection.anchorNode, selection.anchorOffset);
	const focus = pointFor(pageEl, selection.focusNode, selection.focusOffset);
	if (!anchor || !focus) return null;
	return { anchor, focus };
}

function pointFor(pageEl: HTMLElement, node: Node | null, offset: number): FragmentPoint | null {
	if (!node) return null;
	const fragmentEl = fragmentElementOf(pageEl, node);
	if (!fragmentEl) return null;
	const index = Number(fragmentEl.getAttribute(FRAGMENT_INDEX_ATTR));
	if (!Number.isInteger(index)) return null;
	return { fragmentIndex: index, offset: offsetWithinFragment(fragmentEl, node, offset) };
}

function fragmentElementOf(pageEl: HTMLElement, node: Node): HTMLElement | null {
	let el: Node | null = node;
	while (el && el !== pageEl) {
		if (el instanceof HTMLElement && el.hasAttribute(FRAGMENT_INDEX_ATTR)) return el;
		el = el.parentNode;
	}
	return null;
}

/** The character offset of (node, offset) measured from the start of the
 *  fragment's text — sums the lengths of every text run before it (across
 *  plain text nodes + `<mark>` children). */
function offsetWithinFragment(fragmentEl: HTMLElement, node: Node, offset: number): number {
	if (node === fragmentEl) {
		let total = 0;
		for (let i = 0; i < offset && i < fragmentEl.childNodes.length; i++) {
			total += (fragmentEl.childNodes[i]?.textContent ?? "").length;
		}
		return total;
	}
	let total = 0;
	for (const child of Array.from(fragmentEl.childNodes)) {
		if (child === node || child.contains(node)) {
			return total + offset;
		}
		total += (child.textContent ?? "").length;
	}
	return total + offset;
}

export type SelectionMenuOptions = {
	/** The selected passage, previewed so the user confirms the right text. */
	quote: string;
	onConfirm: (color: HighlightColor) => void;
	onCancel: () => void;
};

export type SelectionMenu = {
	/** Quote preview + colour radiogroup — the popover body. */
	body: HTMLElement;
	/** Cancel / Add-highlight action row — the popover footer. */
	footer: HTMLElement;
};

/** The create-highlight dialog content (mounted in a popover): the selected
 *  quote, a colour radiogroup (yellow pre-selected), and confirm / cancel
 *  actions. The highlight is created only on confirm. */
export function buildSelectionMenu(options: SelectionMenuOptions): SelectionMenu {
	const body = document.createElement("div");
	body.className = "books__hl-menu";

	const preview = document.createElement("blockquote");
	preview.className = "books__hl-preview";
	preview.setAttribute("aria-label", t("highlight.selectedText"));
	preview.textContent = options.quote;
	body.append(preview);

	let picked: HighlightColor = COLOR_ORDER[0] ?? HighlightColor.Yellow;
	const swatchByColor = new Map<HighlightColor, HTMLButtonElement>();
	const reflectPick = (): void => {
		for (const [color, btn] of swatchByColor) {
			const active = color === picked;
			btn.setAttribute("aria-checked", active ? "true" : "false");
			btn.classList.toggle("books__hl-swatch--active", active);
		}
	};

	const swatches = document.createElement("div");
	swatches.className = "books__hl-swatches";
	swatches.setAttribute("role", "radiogroup");
	swatches.setAttribute("aria-label", t("highlight.colorLabel"));
	for (const color of COLOR_ORDER) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `books__hl-swatch books__hl-swatch--${color}`;
		btn.setAttribute("role", "radio");
		btn.setAttribute("aria-label", t(COLOR_LABELS[color]));
		btn.setAttribute("data-bs-tooltip", t(COLOR_LABELS[color]));
		btn.addEventListener("click", () => {
			picked = color;
			reflectPick();
		});
		swatchByColor.set(color, btn);
		swatches.append(btn);
	}
	body.append(swatches);
	reflectPick();

	const footer = document.createElement("div");
	footer.className = "books__hl-actions";
	const cancel = document.createElement("button");
	cancel.type = "button";
	cancel.className = "books__hl-cancel";
	cancel.textContent = t("highlight.cancel");
	cancel.addEventListener("click", options.onCancel);
	const confirm = document.createElement("button");
	confirm.type = "button";
	confirm.className = "books__hl-confirm";
	confirm.textContent = t("highlight.add");
	confirm.addEventListener("click", () => options.onConfirm(picked));
	footer.append(cancel, confirm);

	return { body, footer };
}

export type HighlightPanelActions = {
	onGoTo: (range: LocatorRange) => void;
	onSetColor: (id: string, color: HighlightColor) => void;
	onSetNote: (id: string, note: string) => void;
	onRemove: (id: string) => void;
};

/** The backlinks/highlights list panel body. Lists every highlight in
 *  reading order: colour chip, quote, an editable note, recolour swatches,
 *  go-to + remove. */
export function buildHighlightsPanel(
	highlights: readonly Highlight[],
	actions: HighlightPanelActions,
): HTMLElement {
	const body = document.createElement("div");
	body.className = "books__hl-panel";

	const count = document.createElement("p");
	count.className = "books__hl-count";
	count.textContent = plural(highlights.length, "highlight.panel.one", "highlight.panel.other", {
		count: String(highlights.length),
	});
	body.append(count);

	if (highlights.length === 0) {
		const empty = document.createElement("p");
		empty.className = "books__hl-empty";
		empty.textContent = t("highlight.panel.empty");
		body.append(empty);
		return body;
	}

	const list = document.createElement("ul");
	list.className = "books__hl-list";
	for (const highlight of highlights) {
		list.append(highlightRow(highlight, actions));
	}
	body.append(list);
	return body;
}

function highlightRow(highlight: Highlight, actions: HighlightPanelActions): HTMLElement {
	const row = document.createElement("li");
	row.className = "books__hl-item";
	row.dataset.highlightId = highlight.id;

	const head = document.createElement("div");
	head.className = "books__hl-head";

	const quote = document.createElement("button");
	quote.type = "button";
	quote.className = `books__hl-quote books__hl-quote--${highlight.color}`;
	quote.textContent = highlight.quote;
	quote.setAttribute("data-bs-tooltip", t("highlight.goTo"));
	quote.setAttribute("aria-label", t("highlight.goTo"));
	quote.addEventListener("click", () => actions.onGoTo(highlight.anchor));

	const remove = document.createElement("button");
	remove.type = "button";
	remove.className = "books__hl-remove";
	remove.textContent = "×";
	remove.setAttribute("data-bs-tooltip", t("highlight.remove"));
	remove.setAttribute("aria-label", t("highlight.remove"));
	remove.addEventListener("click", () => actions.onRemove(highlight.id));

	head.append(quote, remove);
	row.append(head);

	const recolor = document.createElement("div");
	recolor.className = "books__hl-recolor";
	recolor.setAttribute("role", "radiogroup");
	recolor.setAttribute("aria-label", t("highlight.colorLabel"));
	for (const color of COLOR_ORDER) {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = `books__hl-swatch books__hl-swatch--${color}`;
		btn.setAttribute("role", "radio");
		const active = color === highlight.color;
		btn.setAttribute("aria-checked", active ? "true" : "false");
		btn.classList.toggle("books__hl-swatch--active", active);
		btn.setAttribute("aria-label", t(COLOR_LABELS[color]));
		btn.setAttribute("data-bs-tooltip", t(COLOR_LABELS[color]));
		btn.addEventListener("click", () => actions.onSetColor(highlight.id, color));
		recolor.append(btn);
	}
	row.append(recolor);

	const note = document.createElement("textarea");
	note.className = "books__hl-note";
	note.rows = 2;
	note.value = highlight.note;
	note.placeholder = t("highlight.notePlaceholder");
	note.setAttribute("aria-label", t("highlight.addNote"));
	note.addEventListener("change", () => actions.onSetNote(highlight.id, note.value));
	row.append(note);

	return row;
}
