/**
 * Emoji-codepoint → bundled-asset URL. Mirrors the shell's algorithm
 * (and the per-app copy in `apps/notes/src/ui/emoji-data.ts`): the shell
 * serves WebP glyphs keyed by hyphen-joined hex codepoints under the
 * `brainstorm://emoji/` scheme.
 *
 * Only the filename math lives here — the graph never needs the emoji
 * *metadata* (no picker, no search), so the heavy `unicode-emoji-json`
 * manifest stays out of this bundle. This is the established per-app
 * mirror (notes mirrors the shell the same way); the canonical home is
 * the SDK once it's wired in (Stage 9.13.2).
 */

export function emojiFilename(char: string): string {
	const parts: string[] = [];
	for (const c of char) {
		const cp = c.codePointAt(0);
		if (cp === undefined) continue;
		parts.push(cp.toString(16));
	}
	return `${parts.join("-")}.webp`;
}

export function emojiUrl(char: string): string {
	return `brainstorm://emoji/${emojiFilename(char)}`;
}
