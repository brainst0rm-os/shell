/**
 * Action command palette (9.7.5) — a centred fuzzy list of the app's invokable
 * ACTIONS (save, new file, tab ops, toggle wrap, …) opened with
 * `Cmd/Ctrl+Shift+P`. A thin adapter over the shared {@link openFuzzyPalette}:
 * the overlay, combobox keyboard model, and fuzzy-render loop live there; this
 * file supplies only the command row adapter — `rankCommands`, the row's label
 * span, the i18n strings, and running the chosen command.
 */

import { t } from "../i18n";
import { type EditorCommand, rankCommands } from "../logic/command-palette";
import { type FuzzyPaletteController, openFuzzyPalette } from "./fuzzy-palette";

export type CommandPaletteOptions = {
	commands: readonly EditorCommand[];
	mount: HTMLElement;
	/** Fired once when the palette tears down for any reason (run, Escape,
	 *  backdrop, or `controller.close()`) so the caller can drop its handle. */
	onClose?: () => void;
};

export type CommandPaletteController = FuzzyPaletteController;

export function openCommandPalette(opts: CommandPaletteOptions): CommandPaletteController {
	return openFuzzyPalette<EditorCommand>({
		rows: opts.commands,
		mount: opts.mount,
		rank: rankCommands,
		renderRow: (li, command) => {
			li.dataset.commandId = command.id;
			const name = document.createElement("span");
			name.className = "editor__quickopen-name";
			name.textContent = command.label;
			li.appendChild(name);
		},
		onChoose: (command) => command.run(),
		labels: {
			label: t("commandPaletteLabel"),
			placeholder: t("commandPalettePlaceholder"),
			empty: t("commandPaletteEmpty"),
		},
		...(opts.onClose ? { onClose: opts.onClose } : {}),
	});
}
