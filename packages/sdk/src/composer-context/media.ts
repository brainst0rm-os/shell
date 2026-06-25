/**
 * Composer media helpers — the DOM bits the rail's attach flow needs, shared so
 * every app (Agent, Chats, …) opens the file picker identically rather than
 * re-rolling a transient `<input type="file">`.
 */

/**
 * Open the OS file picker from a sandboxed renderer (a transient, hidden
 * `<input type="file">`) and resolve to the chosen file, or null. No cancel event
 * fires reliably across browsers, so a dismissed picker simply never resolves —
 * harmless (no attach happens); the detached input is removed on selection.
 */
export function pickFile(accept?: string): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		if (accept) input.accept = accept;
		input.style.display = "none";
		input.addEventListener("change", () => {
			resolve(input.files?.[0] ?? null);
			input.remove();
		});
		document.body.appendChild(input);
		input.click();
	});
}
