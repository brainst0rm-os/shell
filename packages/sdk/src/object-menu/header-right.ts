/**
 * `paintHeaderRight` — paints an app-header right group in the canonical
 * cross-app order: content actions and panel toggles first (in the order
 * given), the object ⋯ menu ALWAYS last. The ⋯ anchors the trailing edge
 * so it sits in the same spot in every app; surfaces with no object pass a
 * disabled ⋯ (`createMoreButton(label, { disabled: true })`) rather than
 * omitting it.
 */

export function paintHeaderRight(
	container: HTMLElement,
	children: ReadonlyArray<HTMLElement | null | undefined>,
	more: HTMLElement,
): void {
	const present = children.filter((c): c is HTMLElement => c != null);
	container.replaceChildren(...present, more);
}
