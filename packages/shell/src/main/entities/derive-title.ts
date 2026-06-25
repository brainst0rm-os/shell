/**
 * The one place "what is this object's display title?" is decided.
 *
 * `title = properties.title ?? properties.name ?? ""` — type-agnostic on
 * purpose (a Note has `title`, a Person has `name`, a Bookmark has
 * `title`; none get a per-type allowlist). The search collector and the
 * dashboard pin resolver both call this so a renamed object surfaces
 * identically in search and on a pinned tile — they must never drift.
 */
export function deriveEntityTitle(properties: Record<string, unknown>): string {
	if (typeof properties.title === "string") return properties.title;
	if (typeof properties.name === "string") return properties.name;
	return "";
}
