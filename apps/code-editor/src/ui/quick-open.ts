/**
 * Quick-open palette (9.7.5) — a centred fuzzy jump-to-file overlay over the
 * open files. `Cmd/Ctrl+P` opens it; picking a file routes back through the
 * caller's `onChoose` (the same `selectFile` the sidebar rows use), so the
 * app's navigation history stays correct.
 *
 * A thin adapter over the shared {@link openFuzzyPalette}: the overlay,
 * combobox keyboard model, and fuzzy-render loop live there; this file supplies
 * only the file row adapter — `rankFiles`, the row's name + secondary path
 * spans, the i18n strings, and routing the chosen file id back to the caller.
 */

import { t } from "../i18n";
import type { CodeFileRow } from "../logic/code-projection";
import { fileName } from "../logic/code-view";
import { rankFiles } from "../logic/fuzzy-file";
import { type FuzzyPaletteController, openFuzzyPalette } from "./fuzzy-palette";

export type QuickOpenOptions = {
	rows: readonly CodeFileRow[];
	mount: HTMLElement;
	onChoose: (id: string) => void;
	/** Fired once when the palette tears down for any reason (pick, Escape,
	 *  backdrop, or `controller.close()`) so the caller can drop its handle. */
	onClose?: () => void;
};

export type QuickOpenController = FuzzyPaletteController;

export function openQuickOpen(opts: QuickOpenOptions): QuickOpenController {
	return openFuzzyPalette<CodeFileRow>({
		rows: opts.rows,
		mount: opts.mount,
		rank: rankFiles,
		renderRow: (li, row) => {
			li.dataset.fileId = row.id;
			const name = document.createElement("span");
			name.className = "editor__quickopen-name";
			name.textContent = fileName(row.path);
			const path = document.createElement("span");
			path.className = "editor__quickopen-path";
			path.textContent = row.path;
			li.append(name, path);
		},
		onChoose: (row) => opts.onChoose(row.id),
		labels: {
			label: t("quickOpenLabel"),
			placeholder: t("quickOpenPlaceholder"),
			empty: t("quickOpenEmpty"),
		},
		...(opts.onClose ? { onClose: opts.onClose } : {}),
	});
}
