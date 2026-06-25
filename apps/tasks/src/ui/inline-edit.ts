/**
 * `beginInlineEdit` — swap a static label element for an inline rename
 * `<input>`, commit on Enter / blur, cancel on Escape, and restore the label
 * either way. The single rename mechanism shared by the list-row name, the
 * inspector title, and the header title, so all three behave identically
 * (Enter commits, Escape reverts, blur commits, empty input is ignored).
 */

export type InlineEditOptions = {
	/** Seed value + the baseline a commit is diffed against (no-op if unchanged). */
	value: string;
	ariaLabel: string;
	/** Class for the swapped-in `<input>` so each host keeps its own field chrome. */
	inputClassName: string;
	/** Invoked with the trimmed, changed, non-empty value — never on cancel. */
	onCommit: (next: string) => void;
};

export function beginInlineEdit(label: HTMLElement, opts: InlineEditOptions): void {
	const parent = label.parentElement;
	if (!parent || parent.querySelector("input")) return;

	const input = document.createElement("input");
	input.type = "text";
	input.className = opts.inputClassName;
	input.value = opts.value;
	input.spellcheck = false;
	input.autocomplete = "off";
	input.setAttribute("aria-label", opts.ariaLabel);

	let done = false;
	const commit = (): void => {
		if (done) return;
		done = true;
		const next = input.value.trim();
		if (next.length > 0 && next !== opts.value) opts.onCommit(next);
		input.replaceWith(label);
		label.textContent = next.length > 0 ? next : opts.value;
	};
	const cancel = (): void => {
		if (done) return;
		done = true;
		input.replaceWith(label);
	};

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			commit();
		} else if (event.key === "Escape") {
			event.preventDefault();
			cancel();
		}
	});
	input.addEventListener("blur", commit);

	label.replaceWith(input);
	input.focus();
	input.select();
}
