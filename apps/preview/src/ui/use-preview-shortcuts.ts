/**
 * Host keyboard wiring — file navigation + inspector toggle through the
 * app-side shortcut registry (no raw `e.key` per
 *  §Keyboard handling). The image /
 * PDF renderer modules bind their own zoom / pan / page chords with
 * `capture: true` and stand down to these when not applicable.
 *
 * GoPrev / GoNext stand down while focus sits on a filmstrip thumb — the
 * strip's roving composite binding owns Left/Right there, so the host's
 * file-nav doesn't double-advance on the same chord.
 */

import { useEffect } from "react";
import { ActionId, bindShortcut } from "../shortcuts";

function focusInFilmstrip(): boolean {
	const active = document.activeElement;
	return active instanceof HTMLElement && active.closest(".preview__filmstrip") !== null;
}

export type PreviewShortcutHandlers = {
	onPrev: () => void;
	onNext: () => void;
	onFirst: () => void;
	onLast: () => void;
	onToggleInspector: () => void;
};

export function usePreviewShortcuts(handlers: PreviewShortcutHandlers): void {
	const { onPrev, onNext, onFirst, onLast, onToggleInspector } = handlers;
	useEffect(() => {
		const unbinds = [
			bindShortcut(ActionId.GoPrev, () => {
				if (focusInFilmstrip()) return;
				onPrev();
			}),
			bindShortcut(ActionId.GoNext, () => {
				if (focusInFilmstrip()) return;
				onNext();
			}),
			bindShortcut(ActionId.GoFirst, onFirst),
			bindShortcut(ActionId.GoLast, onLast),
			bindShortcut(ActionId.ToggleInspector, onToggleInspector),
		];
		return () => {
			for (const unbind of unbinds) unbind();
		};
	}, [onPrev, onNext, onFirst, onLast, onToggleInspector]);
}
