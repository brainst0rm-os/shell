/**
 * `<PinInput>` — a segmented numeric PIN entry: `length` single-digit boxes
 * with auto-advance, backspace-to-previous, arrow navigation, and paste-fill.
 * The shared shell primitive for every PIN surface (the lock screen + Settings →
 * Security), so the entry UX + masking + validation live in one place.
 *
 * Digits are masked (`type="password"`) — a PIN is a secret, not a one-time
 * code. Navigation keys route through `matchesChord` (never raw `e.key`, per
 * docs/foundations/35-code-conventions.md §Keyboard handling); digit entry
 * rides `onChange` so no key handling is needed for the common path.
 *
 * `value` is the controlled digit string (0–`length` digits, always left-packed
 * — the component never produces internal gaps). `onComplete` fires when the
 * last box is filled (e.g. to auto-submit the lock screen).
 */

import { useCallback, useId, useRef } from "react";
import { matchesChord } from "../shortcuts/use-shortcut";
import "./pin-input.css";

export type PinInputProps = {
	value: string;
	onChange: (value: string) => void;
	length?: number;
	onComplete?: (value: string) => void;
	disabled?: boolean;
	autoFocus?: boolean;
	/** Accessible name for the group (e.g. "PIN", "Confirm PIN"). */
	ariaLabel: string;
};

/** The PIN length the shell standardises on — used as the default box count
 *  and by consumers to validate "is this PIN complete". */
export const PIN_LENGTH = 6;

export function PinInput({
	value,
	onChange,
	length = PIN_LENGTH,
	onComplete,
	disabled = false,
	autoFocus = false,
	ariaLabel,
}: PinInputProps) {
	const groupId = useId();
	const refs = useRef<Array<HTMLInputElement | null>>([]);

	const focusBox = useCallback((index: number) => {
		const clamped = Math.max(0, index);
		const el = refs.current[clamped];
		if (el) {
			el.focus();
			el.select();
		}
	}, []);

	const commit = useCallback(
		(next: string) => {
			const clean = next.replace(/\D/g, "").slice(0, length);
			onChange(clean);
			if (clean.length === length) onComplete?.(clean);
			return clean;
		},
		[length, onChange, onComplete],
	);

	const handleChange = useCallback(
		(index: number, raw: string) => {
			const digit = raw.replace(/\D/g, "").slice(-1);
			if (digit === "") return;
			// Left-packed: typing in a box past the current end fills the next empty
			// slot, so arrow-jumping ahead can't punch a gap into the value.
			const pos = Math.min(index, value.length);
			const next = commit(value.slice(0, pos) + digit + value.slice(pos + 1));
			if (next.length < length) focusBox(Math.min(pos + 1, length - 1));
		},
		[value, length, commit, focusBox],
	);

	const handleKeyDown = useCallback(
		(index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
			const native = e.nativeEvent;
			if (matchesChord(native, "Backspace")) {
				if (value[index] === undefined || value[index] === "") {
					// Empty box → delete the previous digit and step back.
					if (index > 0) {
						e.preventDefault();
						commit(value.slice(0, index - 1) + value.slice(index));
						focusBox(index - 1);
					}
				} else {
					e.preventDefault();
					commit(value.slice(0, index) + value.slice(index + 1));
				}
				return;
			}
			if (matchesChord(native, "ArrowLeft")) {
				e.preventDefault();
				focusBox(index - 1);
			} else if (matchesChord(native, "ArrowRight")) {
				e.preventDefault();
				focusBox(Math.min(index + 1, value.length));
			}
		},
		[value, commit, focusBox],
	);

	const handlePaste = useCallback(
		(e: React.ClipboardEvent<HTMLInputElement>) => {
			e.preventDefault();
			const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
			if (pasted === "") return;
			const next = commit(pasted);
			focusBox(Math.min(next.length, length - 1));
		},
		[length, commit, focusBox],
	);

	return (
		<div className="pin-input" role="group" aria-label={ariaLabel}>
			{Array.from({ length }, (_, i) => (
				<input
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed-count positional boxes that never reorder
					key={`${groupId}-${i}`}
					ref={(el) => {
						refs.current[i] = el;
					}}
					className="pin-input__box"
					type="password"
					inputMode="numeric"
					autoComplete="off"
					// A non-empty (invisible) placeholder so `:placeholder-shown` can
					// distinguish an empty box from a filled one for the CSS filled state.
					placeholder=" "
					maxLength={1}
					disabled={disabled}
					// biome-ignore lint/a11y/noAutofocus: lock-screen / set-form initial focus is intentional and user-initiated
					autoFocus={autoFocus && i === 0}
					value={value[i] ?? ""}
					aria-label={`${ariaLabel} ${i + 1}`}
					onChange={(e) => handleChange(i, e.target.value)}
					onKeyDown={(e) => handleKeyDown(i, e)}
					onPaste={handlePaste}
					onFocus={(e) => e.target.select()}
				/>
			))}
		</div>
	);
}
