/**
 * Icon-pack picker pane (9.9.3) — a single-select list of the available
 * packs (the built-in Phosphor pack + every installed `IconPack/v1`).
 * Selecting one points the theme's icon-pack reference at it; the app
 * applies it to the in-editor preview via `setActiveIconPack`. Per-glyph
 * override authoring needs an SVG asset pipeline and is deferred.
 *
 * KBN-A-theme-editor: a roving-tabindex radiogroup — Arrow keys move focus
 * (the cursor) without committing; Enter / Space / click commits. The
 * committed pack owns `aria-checked`, the cursor owns roving `tabindex`.
 */

import { type ReactElement, useEffect, useRef, useState } from "react";
import type { IconPackChoice } from "../logic/icon-pack-options";
import type { Translate } from "./translate";

export type IconPackPickerProps = {
	choices: ReadonlyArray<IconPackChoice>;
	selectedKey: string;
	t: Translate;
	onSelect(key: string): void;
};

export function IconPackPicker({
	choices,
	selectedKey,
	t,
	onSelect,
}: IconPackPickerProps): ReactElement {
	const selectedIndex = Math.max(
		0,
		choices.findIndex((c) => c.key === selectedKey),
	);
	const [cursor, setCursor] = useState(selectedIndex);
	const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

	// Keep the cursor anchored on the committed pack when selection changes
	// externally (a fresh fork resets it to the builtin).
	useEffect(() => {
		setCursor(selectedIndex);
	}, [selectedIndex]);

	const moveCursor = (next: number, focus: boolean): void => {
		const clamped = (next + choices.length) % choices.length;
		setCursor(clamped);
		if (focus) rowRefs.current[clamped]?.focus();
	};

	const onKeyDown = (event: React.KeyboardEvent, index: number): void => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			moveCursor(cursor + 1, true);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			moveCursor(cursor - 1, true);
		} else if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			const choice = choices[index];
			if (choice) onSelect(choice.key);
		}
	};

	return (
		<div className="te-packs" role="radiogroup" aria-label={t("iconPack.legend")}>
			{choices.map((choice, index) => {
				const selected = choice.key === selectedKey;
				return (
					<button
						key={choice.key}
						type="button"
						role="radio"
						aria-checked={selected}
						className={selected ? "te-pack te-pack--selected" : "te-pack"}
						tabIndex={index === cursor ? 0 : -1}
						ref={(el) => {
							rowRefs.current[index] = el;
						}}
						onClick={() => onSelect(choice.key)}
						onKeyDown={(event) => onKeyDown(event, index)}
					>
						<span className="te-pack__name">{choice.builtin ? t("iconPack.builtin") : choice.name}</span>
						{choice.builtin && <span className="te-pack__badge">{t("iconPack.builtinBadge")}</span>}
					</button>
				);
			})}
			{choices.length === 1 && <p className="te-packs__hint">{t("iconPack.noneInstalled")}</p>}
		</div>
	);
}
