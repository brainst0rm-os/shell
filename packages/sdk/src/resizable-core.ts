/**
 * Pure resize math + localStorage persistence shared by the imperative
 * `attachResizable` and the React `useResizable` hook, so width clamping,
 * keyboard steps, and the persistence read/write can't drift between the two.
 */

export type ResizableSide = "left" | "right";

export const KEY_STEP_DEFAULT = 8;
export const KEY_STEP_SHIFT = 32;
export const DEFAULT_MIN_WIDTH = 160;
export const DEFAULT_MAX_WIDTH = 560;

export function clampWidth(px: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, px));
}

/** Read a persisted width, clamped to [min, max]; falls back to `fallback`
 *  on absence / parse failure / storage errors (private mode, quota). */
export function readPersistedWidth(
	storageKey: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (!storageKey) return fallback;
	try {
		const raw = globalThis.localStorage?.getItem(storageKey);
		if (raw == null || raw === "") return fallback;
		const n = Number(raw);
		return Number.isFinite(n) ? clampWidth(n, min, max) : fallback;
	} catch {
		return fallback;
	}
}

export function persistWidth(storageKey: string | undefined, px: number): void {
	if (!storageKey) return;
	try {
		globalThis.localStorage?.setItem(storageKey, String(px));
	} catch {
		/* private mode / quota — silent */
	}
}

/** New width after an arrow / Home / End keystroke, or `null` if the key is
 *  not a resize key. Mirrors `attachResizable`'s keyboard contract:
 *  ArrowLeft/Right move 8px (32px with Shift), Home → min, End → max. */
export function widthForResizeKey(
	key: string,
	shiftKey: boolean,
	width: number,
	side: ResizableSide,
	min: number,
	max: number,
): number | null {
	const step = shiftKey ? KEY_STEP_SHIFT : KEY_STEP_DEFAULT;
	const sign = side === "left" ? 1 : -1;
	if (key === "ArrowLeft") return clampWidth(width + -step * sign, min, max);
	if (key === "ArrowRight") return clampWidth(width + step * sign, min, max);
	if (key === "Home") return min;
	if (key === "End") return max;
	return null;
}
