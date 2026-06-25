/**
 * Diagnostics problem list (9.7.6). Renders the built-in linter's findings
 * for the open file as a compact list in the inspector. Display-first: each
 * row shows severity · line · message; activating a row asks the host to
 * reveal that line. Pure DOM builder (no app state) so it's jsdom-testable;
 * inline squiggles over the textarea are the deeper follow-on.
 */

import {
	type Diagnostic,
	DiagnosticCode,
	DiagnosticSeverity,
	countBySeverity,
} from "../logic/diagnostics";

/** Catalog key per diagnostic kind. The message text lives in the i18n
 *  manifest (localised, `{ch}`-interpolated) — never baked at construction. */
const MESSAGE_KEY: Record<DiagnosticCode, string> = {
	[DiagnosticCode.TrailingWhitespace]: "diagnostics.msg.trailingWhitespace",
	[DiagnosticCode.MixedIndent]: "diagnostics.msg.mixedIndent",
	[DiagnosticCode.UnmatchedBracket]: "diagnostics.msg.unmatchedBracket",
	[DiagnosticCode.UnclosedBracket]: "diagnostics.msg.unclosedBracket",
};

function diagnosticMessage(
	d: Diagnostic,
	t: (key: string, params?: Record<string, string>) => string,
): string {
	return t(MESSAGE_KEY[d.code], d.params);
}

export type DiagnosticsListOptions = {
	diagnostics: readonly Diagnostic[];
	t: (key: string, params?: Record<string, string>) => string;
	/** Reveal a 1-based line in the editor (best-effort host hook). */
	onReveal(line: number): void;
};

export function renderDiagnosticsList(opts: DiagnosticsListOptions): HTMLElement {
	const { diagnostics, t, onReveal } = opts;
	const section = document.createElement("div");
	section.className = "editor__diagnostics";

	const head = document.createElement("div");
	head.className = "editor__diagnostics-head";
	const { errors, warnings } = countBySeverity(diagnostics);
	head.textContent =
		diagnostics.length === 0
			? t("diagnostics.clean")
			: t("diagnostics.summary", { errors: String(errors), warnings: String(warnings) });
	section.appendChild(head);

	if (diagnostics.length === 0) return section;

	const list = document.createElement("ul");
	list.className = "editor__diagnostics-list";
	list.setAttribute("aria-label", t("diagnostics.region"));
	for (const d of diagnostics) {
		const li = document.createElement("li");
		const row = document.createElement("button");
		row.type = "button";
		const severe = d.severity === DiagnosticSeverity.Error;
		row.className = `editor__diagnostic editor__diagnostic--${severe ? "error" : "warning"}`;
		row.title = t("diagnostics.reveal", { line: String(d.line) });
		const loc = document.createElement("span");
		loc.className = "editor__diagnostic-loc";
		loc.textContent = t("diagnostics.lineLabel", { line: String(d.line) });
		const msg = document.createElement("span");
		msg.className = "editor__diagnostic-msg";
		msg.textContent = diagnosticMessage(d, t);
		row.append(loc, msg);
		row.addEventListener("click", () => onReveal(d.line));
		li.appendChild(row);
		list.appendChild(li);
	}
	section.appendChild(list);
	return section;
}
