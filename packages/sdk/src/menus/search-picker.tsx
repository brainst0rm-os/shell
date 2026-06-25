/**
 * The shared search picker — a filter input over a host-filtered result list,
 * rendered through the fancy-menus runtime. The fancy-menus replacement for the
 * hand-rolled `.fm-menu` "search input + `role="listbox"`" popups that the
 * editor entity pickers (`/embed`, Mod+K link, `/property`) and the browser
 * omnibox each rolled their own. Unlike `openTypeaheadMenu` (the *caret*
 * typeahead, where the editor owns the text + the keyboard), a search picker
 * carries its OWN input: the runtime's `chrome.filter` input owns focus, the
 * runtime owns arrow / Enter / Escape over the list, and the host owns only the
 * filtering (ranking, exclusions, synthetic rows) + committing a choice.
 *
 * The runtime substring-filters a `static`/`prop`/`store` list source by the
 * filter text — which would clobber a host's own ranking and drop the omnibox's
 * synthetic rows. A `composite` source is passed through untouched (verified
 * against the runtime), so the list reads from `data.items` and the host
 * re-supplies a freshly filtered set on every `filter.onChange`. The runtime's
 * internal filter state is set too, but composite ignores it — no double filter.
 *
 * Imperative by design (mirrors `typeahead-menu.ts` / `context-menu.ts`): one
 * picker is open at a time, so module-level callbacks suffice — set on open,
 * cleared on close.
 */

import {
	BodyKind,
	DimmerMode,
	Horizontal,
	type MenuConfig,
	MenuKind,
	RowKind,
	SourceKind,
	Vertical,
	defineMenu,
} from "@react-fancy-menus/core";
import type { ReactNode } from "react";
import { getActiveMenuStore } from "./active-store";

/** One row in a search picker. `icon` is a pre-rendered node (entity icons are
 *  nodes, not the runtime's `IconParam` spec), so it rides inline in the name
 *  slot. A `disabled` row is the empty-state line — shown, never committed, and
 *  skipped in keyboard nav. */
export type SearchPickerItem = {
	id: string;
	label: string;
	caption?: ReactNode;
	icon?: ReactNode;
	disabled?: boolean;
};

type SearchPickerData = { items: readonly SearchPickerItem[] };

export const SEARCH_PICKER_ID = "bs/search-picker";

/** Gap between the anchor and the picker. */
const SEARCH_PICKER_GAP = 4;
const SEARCH_PICKER_MIN_WIDTH = 320;

/** Set on open, read by the registered config's handlers, cleared on close.
 *  One picker is open at a time (a single caret / omnibox), so a module-level
 *  ref suffices. */
let filterRef: ((query: string) => readonly SearchPickerItem[]) | null = null;
let selectRef: ((id: string) => void) | null = null;
let closeRef: (() => void) | null = null;

/** `FilterConfig.placeholder` is static per config, so the config is rebuilt
 *  (and re-registered — `register` is a `Map.set`, so this replaces) on each
 *  open to carry the per-picker placeholder. */
function buildConfig(placeholder: string, minWidth: number): MenuConfig<SearchPickerData> {
	return defineMenu<SearchPickerData>({
		id: SEARCH_PICKER_ID,
		kind: MenuKind.Context,
		chrome: {
			// A filter input over a listbox is a dialog, not a bare popup menu.
			role: "dialog",
			// No dimmer — the surface behind (editor / page) stays visible.
			dimmer: DimmerMode.None,
			filter: {
				placeholder,
				focusOnMount: true,
				// In-memory host filter — no debounce, the list tracks each keystroke.
				debounceMs: 0,
				underlined: true,
				onChange: (value) => {
					const store = getActiveMenuStore();
					if (filterRef && store?.isOpen(SEARCH_PICKER_ID)) {
						store.updateData(SEARCH_PICKER_ID, { items: filterRef(value) });
					}
				},
			},
		},
		body: {
			kind: BodyKind.List,
			// Composite passes items through untouched — the host owns filtering,
			// the runtime's substring filter never runs over an already-ranked list.
			source: {
				kind: SourceKind.Composite,
				sources: [{ kind: SourceKind.Prop, getItems: (data) => [...data.items] }],
			},
			rows: [
				{
					kind: RowKind.Item,
					match: () => true,
					disabled: (item: SearchPickerItem) => item.disabled === true,
					skipOver: (item: SearchPickerItem) => item.disabled === true,
					className: () => "bs-search-picker-row",
					// The entity icon (when present) is a pre-rendered node, so it rides
					// inline in the name slot rather than the row's `IconParam` slot.
					name: (item: SearchPickerItem): ReactNode =>
						item.icon ? (
							<span>
								<span className="fm-row__icon" aria-hidden="true">
									{item.icon}
								</span>
								<span>{item.label}</span>
							</span>
						) : (
							item.label
						),
					caption: (item: SearchPickerItem): ReactNode => item.caption ?? null,
					onClick: (item: SearchPickerItem, _e: unknown, ctx: { closeAll: () => void }) => {
						if (item.disabled === true) return;
						selectRef?.(item.id);
						ctx.closeAll();
					},
				},
			],
			// The chrome filter input owns focus; the list must not grab it on mount.
			focusOnMount: false,
		},
		position: {
			vertical: Vertical.Bottom,
			horizontal: Horizontal.Left,
			offsetY: SEARCH_PICKER_GAP,
			minWidth,
			followAnchor: true,
		},
		lifecycle: {
			// Fired once the picker is fully closed (Escape / outside-click / after a
			// commit). Clear the refs FIRST so the host callback can't re-enter, then
			// hand control back (focus return / clear host open-state).
			onClose: () => {
				const cb = closeRef;
				filterRef = null;
				selectRef = null;
				closeRef = null;
				cb?.();
			},
		},
	});
}

export type OpenSearchPickerOptions = {
	/** Placeholder for the filter input. */
	placeholder: string;
	/** Accessible name for the picker shell. */
	ariaLabel: string;
	/** Compute the rows for a query — called on open and on every keystroke. The
	 *  host owns ranking / exclusions / synthetic rows. Return a single
	 *  `disabled` row to render an empty-state line. */
	filter: (query: string) => readonly SearchPickerItem[];
	/** Commit a row by id (Enter or click). */
	onSelect: (id: string) => void;
	/** Fired once when the picker closes for any reason — return focus to the
	 *  host / clear the host's open-state here. */
	onClose?: () => void;
	/** The element the picker drops from. Pass this OR `rect` (`rect` wins). */
	anchor?: Element;
	/** A viewport rect to drop from — for a caret with no single anchor element. */
	rect?: DOMRect;
	/** Initial query (default ""). */
	initialQuery?: string;
	/** Min width (default 320). */
	minWidth?: number;
};

/** Open (or, if already open, refresh) the shared search picker. Returns false
 *  when no `<BrainstormMenuProvider>` is mounted, so non-React callers degrade. */
export function openSearchPicker(options: OpenSearchPickerOptions): boolean {
	const store = getActiveMenuStore();
	if (!store) return false;
	filterRef = options.filter;
	selectRef = options.onSelect;
	closeRef = options.onClose ?? null;
	store.register(buildConfig(options.placeholder, options.minWidth ?? SEARCH_PICKER_MIN_WIDTH));
	const param = {
		data: { items: options.filter(options.initialQuery ?? "") },
		...(options.rect ? { rect: options.rect } : options.anchor ? { element: options.anchor } : {}),
		ariaLabel: options.ariaLabel,
	};
	if (store.isOpen(SEARCH_PICKER_ID)) store.update(SEARCH_PICKER_ID, param);
	else store.open(SEARCH_PICKER_ID, param);
	return true;
}

/** Close the shared search picker if it's open (fires `onClose`). */
export function closeSearchPicker(): void {
	getActiveMenuStore()?.close(SEARCH_PICKER_ID);
}
