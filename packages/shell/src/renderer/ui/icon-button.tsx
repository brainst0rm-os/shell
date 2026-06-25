/**
 * IconButton — the design-system primitive for every icon-only clickable
 * surface (close ✕, settings ⚙, pin ＋, navigation arrows, list-row delete,
 * etc.). Every consumer uses this; no surface re-implements icon-button
 * chrome inline.
 *
 * Sizes are tokenised: `Sm` (24×24, icon 14), `Md` (28×28, icon 20),
 * `Lg` (32×32, icon 22). The button is square; the icon is centred; the
 * outer container leaves room for an optical compensation when placed near
 * a panel edge (see CLAUDE.md "Panel headers share height" + the optical-
 * edge rule). The hover / active styles consume `--color-interactive-*`
 * tokens so they look right on both solid surfaces and glass.
 */

import type { CSSProperties, MouseEvent } from "react";
import { forwardRef } from "react";
import { useShortcutLabel } from "../shortcuts/use-shortcut-label";
import { Icon, type IconName } from "./icon";
import "./icon-button.css";

export enum IconButtonSize {
	Sm = "sm",
	Md = "md",
	Lg = "lg",
}

export enum IconButtonVariant {
	/** Default chrome — transparent until hover/active. */
	Ghost = "ghost",
	/** Strong tint — used for primary destructive / confirm shortcuts. */
	Filled = "filled",
}

export type IconButtonProps = {
	icon: IconName;
	label: string;
	onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
	size?: IconButtonSize;
	variant?: IconButtonVariant;
	disabled?: boolean;
	title?: string;
	type?: "button" | "submit";
	className?: string;
	style?: CSSProperties;
	"data-testid"?: string;
	/** Set when the button is a toggle (e.g. pin / mute / star). Renders
	 *  `aria-pressed` and lights the `.icon-button--on` selector so the on
	 *  state reads as enabled, not as accidental hover. */
	pressed?: boolean;
	/**
	 * Shortcut-registry id (e.g. `"shell/cheatsheet"`). When set:
	 *   1. The chord is surfaced on the tooltip via `data-bs-tooltip-shortcut`,
	 *      which the delegated tooltip host renders dimmed after the label — so
	 *      the binding is discoverable on hover even though icon-only buttons
	 *      have no room for an inline `<kbd>` hint like `<Button>` does (6.10d).
	 *   2. `aria-keyshortcuts={chord}` is stamped so assistive tech
	 *      announces the binding without parsing visual glyphs.
	 * Unknown ids / unbound actions leave the tooltip + ARIA unchanged.
	 * Per [24-keyboard-shortcuts.md](../../../../../docs/shell/24-keyboard-shortcuts.md) — Stage 6.10d.
	 */
	shortcutId?: string;
	/** Override the Tab order. Set `-1` when the button lives behind a composite
	 *  row's roving focus (e.g. the Bin's per-row Restore/Purge), so it's
	 *  mouse-clickable but not a separate Tab stop. */
	tabIndex?: number;
};

const ICON_SIZE_BY_BUTTON_SIZE: Record<IconButtonSize, number> = {
	[IconButtonSize.Sm]: 14,
	[IconButtonSize.Md]: 16,
	[IconButtonSize.Lg]: 20,
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
	{
		icon,
		label,
		onClick,
		size = IconButtonSize.Md,
		variant = IconButtonVariant.Ghost,
		disabled = false,
		title,
		type = "button",
		className,
		style,
		"data-testid": testId,
		pressed,
		shortcutId,
		tabIndex,
	},
	ref,
) {
	const classes = ["icon-button", `icon-button--${size}`, `icon-button--${variant}`];
	if (pressed) classes.push("icon-button--on");
	if (className) classes.push(className);
	const shortcut = useShortcutLabel(shortcutId ?? "");
	const hasShortcut = shortcutId !== undefined && shortcut !== null;
	// An explicit `title` wins so contextual hints like "Pin to dashboard
	// (current entity)" aren't clobbered by the default label.
	const tooltip = title !== undefined ? title : label;
	// The chord is shown only on the default (un-overridden) tooltip; the
	// delegated tooltip host renders it dimmed after the label from
	// `data-bs-tooltip-shortcut` (no need to bake it into the label string).
	const chord = title === undefined && hasShortcut ? shortcut.tokens.join("") : undefined;
	// Tooltips come from the single delegated `mountTooltipHost` controller
	// (auto-installed by `BrainstormMenuProvider`), via `data-bs-tooltip`.
	// `aria-label` stays for screen readers. A *disabled* button fires no
	// pointer/focus events, so the host can never open a chip on it — keep the
	// native `title` for that case only, so a greyed control still explains
	// itself on hover.
	return (
		<button
			ref={ref}
			type={type}
			className={classes.join(" ")}
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			aria-pressed={pressed === undefined ? undefined : pressed}
			aria-keyshortcuts={hasShortcut ? shortcut.chord : undefined}
			title={disabled ? tooltip : undefined}
			data-bs-tooltip={tooltip}
			data-bs-tooltip-shortcut={chord}
			data-testid={testId}
			style={style}
			tabIndex={tabIndex}
		>
			<Icon name={icon} size={ICON_SIZE_BY_BUTTON_SIZE[size]} />
		</button>
	);
});
