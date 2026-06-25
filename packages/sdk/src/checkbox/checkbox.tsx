/**
 * `<Checkbox>` — the React twin of `createCheckbox`, sharing the exact
 * `checkbox.css` chrome (visually hidden native `<input>` for semantics /
 * keyboard / focus, painted `.checkbox__box` mirroring `:checked` /
 * `:indeterminate`). React apps render this instead of forking a native
 * `<input type="checkbox">`, so every checkbox looks identical across apps.
 */

import type { JSX } from "react";
import { useEffect, useRef } from "react";

export type CheckboxProps = {
	/** Visible label text. Omit for an icon-only checkbox (pair with `ariaLabel`). */
	readonly label?: string;
	readonly checked: boolean;
	readonly indeterminate?: boolean;
	readonly disabled?: boolean;
	/** Accessible name when there is no visible `label`. */
	readonly ariaLabel?: string;
	readonly onChange: (checked: boolean) => void;
	readonly className?: string;
	readonly testId?: string;
};

export function Checkbox(props: CheckboxProps): JSX.Element {
	const { label, checked, indeterminate, disabled, ariaLabel, onChange, className, testId } = props;
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (inputRef.current) inputRef.current.indeterminate = indeterminate ?? false;
	}, [indeterminate]);

	const classes = ["checkbox", disabled ? "checkbox--disabled" : "", className ?? ""]
		.filter(Boolean)
		.join(" ");

	return (
		<label className={classes}>
			<input
				ref={inputRef}
				type="checkbox"
				className="checkbox__input"
				checked={checked}
				disabled={disabled}
				aria-label={ariaLabel}
				data-testid={testId}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span className="checkbox__box" aria-hidden="true">
				<svg className="checkbox__check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
					<path
						d="M5 13l4 4L19 7"
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
						pathLength="1"
					/>
				</svg>
				<span className="checkbox__dash" />
			</span>
			{label != null ? <span className="checkbox__label">{label}</span> : null}
		</label>
	);
}
