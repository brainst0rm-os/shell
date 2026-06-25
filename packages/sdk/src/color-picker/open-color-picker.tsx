/**
 * `openColorPicker` — the imperative bridge that drops the
 * {@link ColorPickerBody} into a fancy-menus custom-body surface, anchored to
 * a trigger element. Mirrors `openContextMenu`: the call site runs outside
 * React, so it opens on the renderer's published `MenuStore` (the menu host
 * mounted via `mountMenuHost` / `<BrainstormMenuProvider>`).
 *
 * Contract:
 *   - `onPreview` fires on every drag / hex edit — paint it live.
 *   - `onSelect` fires once, on Apply (the committed value).
 *   - `onCancel` fires once when the picker is dismissed without applying
 *     (Cancel button, Escape, outside-click, or being superseded by another
 *     picker). Use it to revert the live preview.
 *
 * Returns false (a no-op) when no menu host is mounted, so callers in
 * non-React code can fall back without throwing.
 */

import {
	BodyKind,
	DimmerMode,
	Horizontal,
	type MenuConfig,
	Vertical,
	defineMenu,
} from "@react-fancy-menus/core";
import { getActiveMenuStore } from "../menus/active-store";
import { ColorPickerBody, type ColorPickerLabels } from "./color-picker-body";
import "./color-picker.css";

export type { ColorPickerLabels } from "./color-picker-body";

type ColorPickerData = {
	initial?: string;
	labels: ColorPickerLabels;
	onPreview: (hex: string) => void;
	onApply: (hex: string) => void;
};

const COLOR_PICKER_ID = "bs/color-picker";
const PICKER_WIDTH = 244;
const PICKER_HEIGHT = 292;
const MENU_GAP = 6;

const colorPickerConfig: MenuConfig<ColorPickerData> = defineMenu<ColorPickerData>({
	id: COLOR_PICKER_ID,
	description: "2D saturation×value + hue + hex colour picker, mounted as a custom-body menu.",
	position: {
		width: PICKER_WIDTH,
		vertical: Vertical.Bottom,
		horizontal: Horizontal.Left,
		offsetY: MENU_GAP,
	},
	// `Default` is an *invisible* full-screen backdrop: it catches the
	// outside-click that dismisses the picker (our `onCancel`/revert path)
	// without dimming — the author keeps seeing the live preview change behind
	// the menu. `None` would render no backdrop, so outside-click wouldn't
	// close; `Visible` would scrim the preview.
	chrome: { dimmer: DimmerMode.Default },
	body: {
		kind: BodyKind.Custom,
		measureHeight: () => PICKER_HEIGHT,
		render: (ctx) => (
			<ColorPickerBody
				labels={ctx.data.labels}
				onPreview={ctx.data.onPreview}
				onApply={(hex) => {
					ctx.data.onApply(hex);
					ctx.close();
				}}
				onCancel={() => ctx.close()}
				{...(ctx.data.initial != null ? { initial: ctx.data.initial } : {})}
			/>
		),
	},
	keyboard: { defaults: { closeOnEscape: true } },
});

export type OpenColorPickerOptions = {
	/** Trigger element the picker drops from; tracked for positioning and
	 *  marked `aria-expanded` while open. */
	anchor: HTMLElement;
	/** Seed colour (`#rrggbb`); the picker opens on a default blue if absent
	 *  or unparseable. */
	initial?: string;
	labels: ColorPickerLabels;
	/** Live value while dragging / typing — paint it immediately. */
	onPreview?: (hex: string) => void;
	/** Committed value (Apply). */
	onSelect: (hex: string) => void;
	/** Dismissed without applying (Cancel / Escape / outside-click / superseded). */
	onCancel?: () => void;
};

// One picker at a time. Tracked so switching directly from one swatch to
// another tidies (and reverts) the prior picker — the runtime wouldn't fire a
// close for an instance superseded by a re-open of the same menu id.
let active: { cleanup: () => void } | null = null;

export function openColorPicker(options: OpenColorPickerOptions): boolean {
	const store = getActiveMenuStore();
	if (!store) return false;
	if (!store.getConfig(COLOR_PICKER_ID)) store.register(colorPickerConfig);

	active?.cleanup();

	const { anchor } = options;
	anchor.setAttribute("aria-expanded", "true");

	let settled = false;
	let unsub = (): void => {};
	const cleanup = (): void => {
		anchor.removeAttribute("aria-expanded");
		unsub();
		if (active?.cleanup === cleanup) active = null;
		if (!settled) {
			settled = true;
			options.onCancel?.();
		}
	};

	const data: ColorPickerData = {
		labels: options.labels,
		onPreview: (hex) => options.onPreview?.(hex),
		onApply: (hex) => {
			settled = true;
			options.onSelect(hex);
		},
		...(options.initial != null ? { initial: options.initial } : {}),
	};

	void store.open(COLOR_PICKER_ID, { data, element: anchor });

	unsub = store.subscribe(() => {
		if (!store.isOpen(COLOR_PICKER_ID)) cleanup();
	});
	active = { cleanup };
	return true;
}
