/**
 * The shadcn.io-style colour picker body: a 2D saturation×value area, a hue
 * track, and a hex field — the rich replacement for the OS `<input
 * type="color">`. Self-contained UX; the menu shell (positioning, dimmer,
 * lifecycle) is owned by `openColorPicker`, the picker only owns its own
 * controls.
 *
 * Every interactive change is pushed up as `onPreview` so the consumer can
 * paint it live (the theme editor updates its preview pane as you drag); the
 * value commits only on `onApply`.
 */

import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useRef,
	useState,
} from "react";
import { type Hsv, hexToHsv, hsvToHex, normalizeHex } from "./color-conversion";

const DEFAULT_HSV: Hsv = { h: 220, s: 80, v: 90 };

export type ColorPickerLabels = {
	/** `aria-label` + accessible name for the hex text field. */
	hex: string;
	/** Commit button. */
	apply: string;
	/** Dismiss button. */
	cancel: string;
	/** `aria-label` for the 2D saturation×value area. */
	saturationValue: string;
	/** `aria-label` for the hue track. */
	hue: string;
};

export type ColorPickerBodyProps = {
	initial?: string;
	labels: ColorPickerLabels;
	onPreview: (hex: string) => void;
	onApply: (hex: string) => void;
	onCancel: () => void;
};

const clampPct = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export function ColorPickerBody({
	initial,
	labels,
	onPreview,
	onApply,
	onCancel,
}: ColorPickerBodyProps) {
	const seed = (initial && hexToHsv(initial)) || DEFAULT_HSV;
	const [hsv, setHsv] = useState<Hsv>(seed);
	const [hex, setHex] = useState(() => hsvToHex(seed.h, seed.s, seed.v));
	// The raw hex string while the field is mid-edit and not yet a valid
	// colour, so clearing/retyping doesn't snap the value back under the caret.
	const [draft, setDraft] = useState<string | null>(null);

	// Live HSV held in a ref too: a pointer drag re-renders on every move, and
	// the next move handler must read the value committed by the previous one
	// (state is stale until the render flushes).
	const hsvRef = useRef(hsv);
	hsvRef.current = hsv;

	const emit = (next: Hsv): void => {
		const nextHex = hsvToHex(next.h, next.s, next.v);
		hsvRef.current = next;
		setHsv(next);
		setHex(nextHex);
		setDraft(null);
		onPreview(nextHex);
	};

	const svRef = useRef<HTMLDivElement>(null);
	const svDragging = useRef(false);
	const svUpdate = (clientX: number, clientY: number): void => {
		const el = svRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) return;
		emit({
			h: hsvRef.current.h,
			s: Math.round(clamp01((clientX - r.left) / r.width) * 100),
			v: Math.round((1 - clamp01((clientY - r.top) / r.height)) * 100),
		});
	};

	const hueRef = useRef<HTMLDivElement>(null);
	const hueDragging = useRef(false);
	const hueUpdate = (clientX: number): void => {
		const el = hueRef.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		if (r.width === 0) return;
		emit({
			h: Math.round(clamp01((clientX - r.left) / r.width) * 360),
			s: hsvRef.current.s,
			v: hsvRef.current.v,
		});
	};

	const drag = (
		dragging: { current: boolean },
		update: (clientX: number, clientY: number) => void,
	) => {
		const release = (e: ReactPointerEvent<HTMLDivElement>): void => {
			dragging.current = false;
			try {
				e.currentTarget.releasePointerCapture(e.pointerId);
			} catch {
				// Pointer was never captured (e.g. a cancelled drag) — safe to ignore.
			}
		};
		return {
			onPointerDown: (e: ReactPointerEvent<HTMLDivElement>): void => {
				if (e.button !== 0) return;
				dragging.current = true;
				e.currentTarget.setPointerCapture(e.pointerId);
				update(e.clientX, e.clientY);
			},
			onPointerMove: (e: ReactPointerEvent<HTMLDivElement>): void => {
				if (dragging.current) update(e.clientX, e.clientY);
			},
			onPointerUp: release,
			onPointerCancel: release,
		};
	};

	const onSvKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
		const step = e.shiftKey ? 10 : 1;
		let { s, v } = hsv;
		// keyboard-exempt
		if (e.key === "ArrowLeft") s -= step;
		// keyboard-exempt
		else if (e.key === "ArrowRight") s += step;
		// keyboard-exempt
		else if (e.key === "ArrowUp") v += step;
		// keyboard-exempt
		else if (e.key === "ArrowDown") v -= step;
		else return;
		e.preventDefault();
		emit({ h: hsv.h, s: clampPct(s), v: clampPct(v) });
	};

	const onHueKey = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
		const step = e.shiftKey ? 10 : 1;
		let h = hsv.h;
		// keyboard-exempt
		if (e.key === "ArrowLeft" || e.key === "ArrowDown") h -= step;
		// keyboard-exempt
		else if (e.key === "ArrowRight" || e.key === "ArrowUp") h += step;
		else return;
		e.preventDefault();
		emit({ h: (Math.round(h) + 360) % 360, s: hsv.s, v: hsv.v });
	};

	const onHexInput = (raw: string): void => {
		const parsed = normalizeHex(raw);
		const next = parsed ? hexToHsv(parsed) : null;
		if (!parsed || !next) {
			setDraft(raw);
			return;
		}
		hsvRef.current = next;
		setDraft(null);
		setHsv(next);
		setHex(parsed);
		onPreview(parsed);
	};

	return (
		<div className="bs-color-picker">
			<div
				ref={svRef}
				className="bs-color-picker__area"
				role="slider"
				tabIndex={0}
				aria-label={labels.saturationValue}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={hsv.s}
				aria-valuetext={`${hsv.s}%, ${hsv.v}%`}
				style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
				onKeyDown={onSvKey}
				{...drag(svDragging, svUpdate)}
			>
				<span
					className="bs-color-picker__area-thumb"
					style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: hex }}
				/>
			</div>

			<div
				ref={hueRef}
				className="bs-color-picker__hue"
				role="slider"
				tabIndex={0}
				aria-label={labels.hue}
				aria-valuemin={0}
				aria-valuemax={360}
				aria-valuenow={hsv.h}
				onKeyDown={onHueKey}
				{...drag(hueDragging, (clientX) => hueUpdate(clientX))}
			>
				<span className="bs-color-picker__hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
			</div>

			<div className="bs-color-picker__row">
				<span
					className="bs-color-picker__preview"
					style={{ backgroundColor: hex }}
					aria-hidden="true"
				/>
				<input
					className="bs-color-picker__hex"
					value={draft ?? hex.toUpperCase()}
					onChange={(e) => onHexInput(e.target.value)}
					spellCheck={false}
					maxLength={7}
					aria-label={labels.hex}
				/>
			</div>

			<div className="bs-color-picker__actions">
				<button type="button" className="bs-btn bs-btn--sm bs-btn--secondary" onClick={onCancel}>
					{labels.cancel}
				</button>
				<button
					type="button"
					className="bs-btn bs-btn--sm"
					data-bs-primary=""
					onClick={() => onApply(hex)}
				>
					{labels.apply}
				</button>
			</div>
		</div>
	);
}
