/**
 * Group the canonical token namespace into editable grid sections. Pure
 * — the grid renderer consumes `groupTokens(CANONICAL_TOKEN_NAMES)` and
 * the section label is derived from the token name so the grouping stays
 * in lockstep with the namespace (no hand-maintained section table).
 *
 * Colour tokens (`--color-*`) sub-group by their second segment
 * (`color.background`, `color.accent`, …) since there are ~50 of them;
 * every other family groups by its first segment (`space`, `radius`,
 * `shadow`, `text`, `motion`, `control`, `glass`, `z`).
 */

export type TokenRow = { name: string; section: string; isColor: boolean };
export type TokenSectionGroup = { section: string; rows: TokenRow[] };

/** `--color-*` tokens carry a CSS colour value (so they get a colour
 *  picker affordance). `--shadow-*` are box-shadow strings and `--glass-
 *  blur` etc. are lengths/numbers — text-edited, not colour-picked. */
export function isColorToken(name: string): boolean {
	return name.startsWith("--color-");
}

/** The grid section a token belongs to. */
export function sectionFor(name: string): string {
	const segments = name.replace(/^--/, "").split("-");
	const [first, second] = segments;
	if (first === "color" && second) return `color.${second}`;
	return first ?? name;
}

/** Group tokens into ordered sections, preserving the input order within
 *  and across sections (the canonical list is sorted, so families are
 *  already contiguous). */
export function groupTokens(names: readonly string[]): TokenSectionGroup[] {
	const groups: TokenSectionGroup[] = [];
	const bySection = new Map<string, TokenSectionGroup>();
	for (const name of names) {
		const section = sectionFor(name);
		let group = bySection.get(section);
		if (!group) {
			group = { section, rows: [] };
			bySection.set(section, group);
			groups.push(group);
		}
		group.rows.push({ name, section, isColor: isColorToken(name) });
	}
	return groups;
}
