/**
 * `<Searchbar>` — the React twin of `attachSearchbar`. Shares the same
 * `.bs-searchbar` chrome (one CSS block in `app-theme.ts`) so a searchbar
 * looks identical whether the call site is React (notes / settings /
 * marketplace / cheatsheet) or plain DOM (tasks / whiteboard).
 *
 * The clear ✕ only renders when `clearLabel` is set AND `value` is
 * non-empty — single source of truth, no per-app conditional render.
 */

import { type KeyboardEvent as ReactKeyboardEvent, type Ref, useCallback, useId } from "react";
import { Icon } from "../icon/icon";
import { IconName } from "../icon/icon-registry";

export interface SearchbarProps {
	value: string;
	onChange: (next: string) => void;
	placeholder: string;
	/** Defaults to `placeholder`. */
	ariaLabel?: string;
	/** Localized label for the trailing ✕. Omit to suppress the button. */
	clearLabel?: string;
	/** Custom clear handler; defaults to `onChange("")`. */
	onClear?: () => void;
	autoFocus?: boolean;
	inputRef?: Ref<HTMLInputElement>;
	onKeyDown?: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
	className?: string;
	inputClassName?: string;
	testId?: string;
	inputTestId?: string;
}

export function Searchbar({
	value,
	onChange,
	placeholder,
	ariaLabel,
	clearLabel,
	onClear,
	autoFocus,
	inputRef,
	onKeyDown,
	className,
	inputClassName,
	testId,
	inputTestId,
}: SearchbarProps) {
	const inputId = useId();
	const rootClass = className ? `bs-searchbar ${className}` : "bs-searchbar";
	const inputClass = inputClassName
		? `bs-searchbar__input ${inputClassName}`
		: "bs-searchbar__input";

	const handleClear = useCallback(() => {
		if (onClear) onClear();
		else onChange("");
	}, [onClear, onChange]);

	const showClear = clearLabel !== undefined && value.length > 0;

	return (
		<label className={rootClass} htmlFor={inputId} data-testid={testId}>
			<span className="bs-searchbar__icon" aria-hidden="true">
				<Icon name={IconName.Search} size={14} />
			</span>
			<input
				id={inputId}
				ref={inputRef}
				type="search"
				className={inputClass}
				autoComplete="off"
				spellCheck={false}
				placeholder={placeholder}
				aria-label={ariaLabel ?? placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={onKeyDown}
				data-testid={inputTestId}
			/>
			{showClear ? (
				<button
					type="button"
					className="bs-searchbar__clear"
					aria-label={clearLabel}
					data-bs-tooltip={clearLabel}
					onClick={handleClear}
				>
					<Icon name={IconName.Close} size={12} />
				</button>
			) : null}
		</label>
	);
}
