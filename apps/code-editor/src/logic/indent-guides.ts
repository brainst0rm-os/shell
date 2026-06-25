/**
 * Indent guides (9.7.3). Computes the indentation depth (in guide columns)
 * for each line so the editor can draw vertical guide lines at each level.
 * A blank line inherits the depth of the next non-blank line (so guides run
 * unbroken through blank lines inside a block — the standard editor
 * behaviour). Pure (no DOM).
 */

const DEFAULT_TAB_WIDTH = 2;

/** Visual indent columns of a line's leading whitespace (tabs expand to
 *  `tabWidth`). Returns `null` for a blank/whitespace-only line (its depth
 *  is resolved from context by {@link indentGuideDepths}). */
function leadingColumns(line: string, tabWidth: number): number | null {
	let cols = 0;
	for (const ch of line) {
		if (ch === " ") cols++;
		else if (ch === "\t") cols += tabWidth;
		else return cols;
	}
	return null; // blank line
}

/**
 * Number of indent guides to draw on each line. A guide is one per full
 * `tabWidth` columns of indentation BEFORE the line's content (a line
 * indented to column 4 with tabWidth 2 shows 2 guides). Blank lines take
 * the smaller of the surrounding non-blank depths so a guide doesn't jut
 * past the block it belongs to.
 */
export function indentGuideDepths(content: string, tabWidth = DEFAULT_TAB_WIDTH): number[] {
	const lines = content.length === 0 ? [""] : content.split("\n");
	const raw = lines.map((l) => leadingColumns(l, tabWidth));
	const depths: number[] = new Array(lines.length).fill(0);
	for (let i = 0; i < lines.length; i++) {
		let cols = raw[i] ?? null;
		if (cols === null) {
			// Blank line — min(prev non-blank, next non-blank) so the guide
			// only runs where both neighbours have it.
			const prev = prevNonBlank(raw, i);
			const next = nextNonBlank(raw, i);
			cols = Math.min(prev ?? 0, next ?? 0);
		}
		depths[i] = Math.floor(cols / tabWidth);
	}
	return depths;
}

function prevNonBlank(raw: readonly (number | null)[], i: number): number | null {
	for (let k = i - 1; k >= 0; k--) {
		if (raw[k] !== null) return raw[k] as number;
	}
	return null;
}

function nextNonBlank(raw: readonly (number | null)[], i: number): number | null {
	for (let k = i + 1; k < raw.length; k++) {
		if (raw[k] !== null) return raw[k] as number;
	}
	return null;
}
