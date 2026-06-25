/**
 * Completion popup (9.7.3 — autocomplete) — the caret-anchored candidate
 * list painted for buffer-driven completions.
 *
 * Deliberately NOT the shared fancy-menus runtime: a completion popup
 * must keep keyboard focus in the `<textarea>` (so typing keeps growing +
 * filtering the prefix) and follow the text caret pixel-for-pixel — the
 * focus-stealing, element-anchored menu model fits neither. This is the
 * same in-editor-chrome exception the find bar makes. Pure list render +
 * a selection cursor; the pane owns the buffer edit on accept.
 */

import { type CompletionItem, CompletionKind } from "../logic/autocomplete";

const POPUP_CLASS = "editor__completion";
const ITEM_CLASS = "editor__completion-item";
const ITEM_ACTIVE_CLASS = "editor__completion-item--active";
const KIND_CLASS = "editor__completion-kind";
const LABEL_CLASS = "editor__completion-label";

/** Per-instance id seed so multiple panes get distinct listbox / option ids
 *  for the `aria-controls` / `aria-activedescendant` wiring. */
let popupSeq = 0;

/** Pixel anchor for the popup, relative to its mount's padding box. */
export interface CompletionAnchor {
	/** Left edge of the replaced word (caret-column x). */
	left: number;
	/** Top of the caret's line — the popup's bottom edge when flipped up. */
	top: number;
	/** Bottom of the caret's line — the popup's top edge by default. */
	bottom: number;
}

export interface CompletionPopupHandle {
	readonly element: HTMLElement;
	/** Whether the popup is currently shown. */
	readonly isOpen: boolean;
	/** The items currently rendered (empty when closed). */
	readonly items: readonly CompletionItem[];
	/** Render the list + position it; selection resets to the first item.
	 *  An empty list hides the popup. */
	show(items: readonly CompletionItem[], anchor: CompletionAnchor): void;
	/** Re-anchor without changing items or selection (scroll follow). */
	reposition(anchor: CompletionAnchor): void;
	hide(): void;
	/** Move the selection by `delta` with wraparound; no-op when closed. */
	move(delta: number): void;
	/** The currently highlighted item, or null when closed/empty. */
	selected(): CompletionItem | null;
	dispose(): void;
}

/** Short kind affordance shown before each label (icon-free, theme-safe). */
const KIND_GLYPH: Record<CompletionKind, string> = {
	[CompletionKind.Word]: "abc",
	[CompletionKind.Keyword]: "key",
};

export function createCompletionPopup(opts: {
	listLabel: string;
	/** The editing surface this popup completes — wired as the combobox input
	 *  (`aria-controls` / `aria-expanded` / `aria-activedescendant`) so a
	 *  screen reader announces the active completion while focus stays in it. */
	input: HTMLElement;
	onAccept: (item: CompletionItem) => void;
}): CompletionPopupHandle {
	const listboxId = `bs-completion-${++popupSeq}`;
	const optionId = (i: number): string => `${listboxId}-opt-${i}`;

	const element = document.createElement("ul");
	element.className = POPUP_CLASS;
	element.id = listboxId;
	element.setAttribute("role", "listbox");
	element.setAttribute("aria-label", opts.listLabel);
	element.hidden = true;

	// Combobox wiring on the input: the list is announced as autocomplete and
	// the popup toggles `aria-expanded` as it opens/closes.
	opts.input.setAttribute("aria-autocomplete", "list");
	opts.input.setAttribute("aria-controls", listboxId);
	opts.input.setAttribute("aria-expanded", "false");

	let items: readonly CompletionItem[] = [];
	let index = 0;
	let open = false;

	function renderSelection(): void {
		opts.input.setAttribute("aria-activedescendant", optionId(index));
		const rows = element.querySelectorAll<HTMLElement>(`.${ITEM_CLASS}`);
		rows.forEach((row, i) => {
			const active = i === index;
			row.classList.toggle(ITEM_ACTIVE_CLASS, active);
			row.setAttribute("aria-selected", active ? "true" : "false");
			// Guarded — scrollIntoView is unimplemented in jsdom / headless.
			if (active && typeof row.scrollIntoView === "function") {
				row.scrollIntoView({ block: "nearest" });
			}
		});
	}

	function position(anchor: CompletionAnchor): void {
		element.style.left = `${anchor.left}px`;
		// Default below the caret line; flip above only when the popup would
		// overflow the mount's bottom AND there is room above.
		element.style.top = `${anchor.bottom}px`;
		const host = element.offsetParent as HTMLElement | null;
		if (
			host &&
			anchor.bottom + element.offsetHeight > host.clientHeight &&
			anchor.top - element.offsetHeight >= 0
		) {
			element.style.top = `${anchor.top - element.offsetHeight}px`;
		}
	}

	return {
		element,
		get isOpen() {
			return open;
		},
		get items() {
			return items;
		},
		show(next, anchor) {
			items = next;
			index = 0;
			element.replaceChildren();
			next.forEach((item, i) => {
				const row = document.createElement("li");
				row.className = ITEM_CLASS;
				row.id = optionId(i);
				row.setAttribute("role", "option");
				const kind = document.createElement("span");
				kind.className = KIND_CLASS;
				kind.dataset.kind = item.kind;
				kind.textContent = KIND_GLYPH[item.kind];
				kind.setAttribute("aria-hidden", "true");
				const label = document.createElement("span");
				label.className = LABEL_CLASS;
				label.textContent = item.label;
				row.append(kind, label);
				// Accept on click; mousedown is prevented so clicking a row never
				// pulls focus out of the textarea (which would close the popup).
				row.addEventListener("mousedown", (event) => event.preventDefault());
				row.addEventListener("click", () => opts.onAccept(item));
				element.appendChild(row);
			});
			open = next.length > 0;
			element.hidden = !open;
			opts.input.setAttribute("aria-expanded", open ? "true" : "false");
			if (!open) {
				opts.input.removeAttribute("aria-activedescendant");
				return;
			}
			renderSelection();
			position(anchor);
		},
		reposition(anchor) {
			if (open) position(anchor);
		},
		hide() {
			if (!open) return;
			open = false;
			element.hidden = true;
			element.replaceChildren();
			items = [];
			index = 0;
			opts.input.setAttribute("aria-expanded", "false");
			opts.input.removeAttribute("aria-activedescendant");
		},
		move(delta) {
			if (!open || items.length === 0) return;
			index = (index + delta + items.length) % items.length;
			renderSelection();
		},
		selected() {
			return open ? (items[index] ?? null) : null;
		},
		dispose() {
			element.remove();
		},
	};
}
