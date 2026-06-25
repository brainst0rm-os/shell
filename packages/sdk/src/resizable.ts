/**
 * Vanilla-DOM panel resizer. Apps attach this to a thin drag-handle element
 * sitting on the panel's flexible edge; the helper calls back with the new
 * width on every pointer move, which the host applies (typically by writing
 * a CSS variable consumed by the layout).
 *
 * Keyboard: handle is meant to carry `role="separator"` + `tabindex="0"`.
 * ArrowLeft / ArrowRight move the divider 8px (32px with Shift); Home / End
 * snap to min / max. Double-click resets to `defaultWidth`.
 *
 * Persistence: when `storageKey` is set, the resolved width is written to
 * `localStorage` after every commit (drag end, keystroke, dblclick).
 *
 * Collapse / expand affordances may opt into a smooth tween by calling
 * `setWidth(px, { animated: true })`. The tween rides `requestAnimationFrame`
 * with a cubic ease-out (default ~200ms); `prefers-reduced-motion` short-
 * circuits to an instant write. Drag remains instant — animating during
 * drag would feel laggy and de-sync the divider from the cursor.
 */

import { MOTION_DURATION_PANEL_COLLAPSE_MS, tweenNumber } from "./motion";
import {
	DEFAULT_MAX_WIDTH,
	DEFAULT_MIN_WIDTH,
	type ResizableSide,
	clampWidth,
	persistWidth,
	readPersistedWidth,
	widthForResizeKey,
} from "./resizable-core";

export type { ResizableSide };
export {
	useResizable,
	type UseResizableOptions,
	type UseResizableResult,
	type ResizableHandleProps,
} from "./use-resizable";

export interface ResizableOptions {
	handle: HTMLElement;
	side: ResizableSide;
	defaultWidth: number;
	min?: number;
	max?: number;
	onWidth: (px: number) => void;
	storageKey?: string;
}

export interface SetWidthOptions {
	/** Tween the host-side `onWidth` from the current width to `px` over
	 *  ~200ms (`MOTION_DURATION_PANEL_COLLAPSE_MS`). Reduced-motion users
	 *  get an instant write. Skipped while a drag is in progress so the
	 *  divider can't fight the cursor. */
	animated?: boolean;
	/** Override the tween duration. Useful for tests / staged demos. */
	durationMs?: number;
}

export interface ResizableHandle {
	destroy(): void;
	setWidth(px: number, opts?: SetWidthOptions): void;
	reset(): void;
	getWidth(): number;
}

/**
 * Read a persisted panel width from localStorage and write it onto a CSS
 * variable on `document.body` SYNCHRONOUSLY, before the renderer paints
 * its first frame. Apps call this from their entry script ahead of
 * `createRoot().render(...)` / first DOM mount.
 *
 * Without this pre-mount step, `attachResizable`'s own read happens inside
 * the ref-callback (i.e. after React's first paint), so the renderer
 * paints once at the CSS default and then re-paints at the persisted
 * width. With `.window { transition: grid-template-columns 180ms }`
 * that re-paint visibly animates on every app launch.
 *
 * The arguments mirror `attachResizable` so the two stay in sync: same
 * `storageKey`, same min/max clamp, same fallback `defaultWidth`.
 */
export interface ApplyPersistedPanelWidthOptions {
	storageKey: string;
	cssVar: string;
	defaultWidth: number;
	min?: number;
	max?: number;
}

export function applyPersistedPanelWidth(opts: ApplyPersistedPanelWidthOptions): void {
	const min = opts.min ?? DEFAULT_MIN_WIDTH;
	const max = opts.max ?? DEFAULT_MAX_WIDTH;
	const px = readPersistedWidth(opts.storageKey, opts.defaultWidth, min, max);
	try {
		document.body.style.setProperty(opts.cssVar, `${px}px`);
	} catch {
		/* body not in DOM yet (very rare given this runs from app entry) */
	}
}

export function attachResizable(opts: ResizableOptions): ResizableHandle {
	const { handle, side, defaultWidth, onWidth, storageKey } = opts;
	const min = opts.min ?? DEFAULT_MIN_WIDTH;
	const max = opts.max ?? DEFAULT_MAX_WIDTH;

	const clamp = (px: number): number => clampWidth(px, min, max);
	const persist = (px: number): void => persistWidth(storageKey, px);

	let width = readPersistedWidth(storageKey, defaultWidth, min, max);
	const apply = (px: number): void => {
		width = clamp(px);
		onWidth(width);
	};
	apply(width);

	let pointerId: number | null = null;
	let dragStartX = 0;
	let dragStartWidth = 0;
	let cancelTween: (() => void) | null = null;

	const cancelActiveTween = (): void => {
		if (cancelTween) {
			cancelTween();
			cancelTween = null;
		}
	};

	const onPointerMove = (ev: PointerEvent): void => {
		if (pointerId !== ev.pointerId) return;
		const dx = ev.clientX - dragStartX;
		apply(side === "left" ? dragStartWidth + dx : dragStartWidth - dx);
	};

	const endDrag = (ev: PointerEvent): void => {
		if (pointerId !== ev.pointerId) return;
		try {
			handle.releasePointerCapture(pointerId);
		} catch {
			/* already released */
		}
		pointerId = null;
		document.body.classList.remove("is-resizing");
		handle.removeEventListener("pointermove", onPointerMove);
		handle.removeEventListener("pointerup", endDrag);
		handle.removeEventListener("pointercancel", endDrag);
		persist(width);
	};

	const onPointerDown = (ev: PointerEvent): void => {
		if (ev.button !== 0) return;
		cancelActiveTween();
		pointerId = ev.pointerId;
		dragStartX = ev.clientX;
		dragStartWidth = width;
		try {
			handle.setPointerCapture(pointerId);
		} catch {
			/* environments without pointer capture (jsdom) */
		}
		document.body.classList.add("is-resizing");
		handle.addEventListener("pointermove", onPointerMove);
		handle.addEventListener("pointerup", endDrag);
		handle.addEventListener("pointercancel", endDrag);
		ev.preventDefault();
	};

	const onDoubleClick = (ev: MouseEvent): void => {
		ev.preventDefault();
		apply(defaultWidth);
		persist(defaultWidth);
	};

	const onKeyDown = (ev: KeyboardEvent): void => {
		const next = widthForResizeKey(ev.key, ev.shiftKey, width, side, min, max);
		if (next === null) return;
		apply(next);
		persist(width);
		ev.preventDefault();
	};

	handle.addEventListener("pointerdown", onPointerDown);
	handle.addEventListener("dblclick", onDoubleClick);
	handle.addEventListener("keydown", onKeyDown);

	return {
		destroy(): void {
			cancelActiveTween();
			handle.removeEventListener("pointerdown", onPointerDown);
			handle.removeEventListener("dblclick", onDoubleClick);
			handle.removeEventListener("keydown", onKeyDown);
			handle.removeEventListener("pointermove", onPointerMove);
			handle.removeEventListener("pointerup", endDrag);
			handle.removeEventListener("pointercancel", endDrag);
			if (pointerId !== null) {
				try {
					handle.releasePointerCapture(pointerId);
				} catch {
					/* already released */
				}
				pointerId = null;
			}
			document.body.classList.remove("is-resizing");
		},
		setWidth(px: number, opts?: SetWidthOptions): void {
			cancelActiveTween();
			const target = clamp(px);
			// Mid-drag wins over animated requests: the user is steering the
			// divider directly, so a programmatic tween here would race the
			// pointer and the divider would visibly stutter.
			if (opts?.animated && pointerId === null) {
				const from = width;
				const dur = opts.durationMs ?? MOTION_DURATION_PANEL_COLLAPSE_MS;
				cancelTween = tweenNumber(from, target, dur, (px) => {
					apply(px);
				});
				persist(target);
				return;
			}
			apply(target);
			persist(width);
		},
		reset(): void {
			cancelActiveTween();
			apply(defaultWidth);
			persist(defaultWidth);
		},
		getWidth(): number {
			return width;
		},
	};
}
