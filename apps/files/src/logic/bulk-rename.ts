/**
 * Multi-item rename (9.8.12): "base N" numbering over the selection, in
 * visible order, preserving each item's extension ("Report 1.png",
 * "Report 2.pdf", …). Pure so the numbering/extension rules are unit-tested
 * without the store; the app applies the plan via `setEntityName` per id.
 */

/** The extension suffix (".png") of `name`, or "" — a leading dot
 *  (".gitignore") is a hidden-file NAME, not an extension. */
function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return "";
	const ext = name.slice(dot + 1);
	if (ext.length === 0 || ext.length > 8 || ext.includes(" ")) return "";
	return `.${ext}`;
}

/** The new name for the item at `index` (0-based; numbering is 1-based). */
export function bulkRenameName(base: string, index: number, originalName: string): string {
	return `${base} ${index + 1}${extensionOf(originalName)}`;
}

/** The full rename plan for a selection's current names, in order. */
export function bulkRenamePlan(base: string, names: readonly string[]): string[] {
	return names.map((name, index) => bulkRenameName(base, index, name));
}

/**
 * A collision-aware rename plan. Single-rename guards against clashing with
 * untouched siblings; bulk-rename must too. The base sequence ("Report 1",
 * "Report 2", …) is bumped past any name already taken in the target folder
 * by a NON-selected sibling (and past names this plan has itself assigned),
 * so no two members in the folder end up sharing a name.
 *
 * `taken` is the set of sibling names NOT in the selection (the selection's
 * own current names are about to change, so they don't block). Numbering
 * stays gapless within the selection's own sequence and only skips a number
 * when that exact `base N` (with the item's extension) is occupied.
 */
export function bulkRenamePlanAvoiding(
	base: string,
	names: readonly string[],
	taken: ReadonlySet<string>,
): string[] {
	const used = new Set(taken);
	const plan: string[] = [];
	let counter = 1;
	for (const name of names) {
		const ext = extensionOf(name);
		let candidate = `${base} ${counter}${ext}`;
		while (used.has(candidate)) {
			counter += 1;
			candidate = `${base} ${counter}${ext}`;
		}
		plan.push(candidate);
		used.add(candidate);
		counter += 1;
	}
	return plan;
}
