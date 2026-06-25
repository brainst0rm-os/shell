/**
 * Per-vault Bookmarks settings — the kv record behind the 9.18.5 "download
 * page content" vault default. Tolerant parse: a missing / legacy / malformed
 * value falls back to the defaults rather than poisoning the app state
 * (mirrors `collections-codec.ts`).
 */

/** kv key for the per-vault settings record. */
export const SETTINGS_KEY = "bookmark-settings";

export type BookmarkSettings = {
	/** Initial state of the compose-popover "Download page content" checkbox
	 *  (9.18.5 per-vault default). Saving a bookmark with the checkbox flipped
	 *  persists the new value — the vault default follows the user's last
	 *  deliberate choice, toggleable both ways from the compose surface. */
	downloadContentDefault: boolean;
};

export const DEFAULT_BOOKMARK_SETTINGS: Readonly<BookmarkSettings> = Object.freeze({
	downloadContentDefault: true,
});

/** Parse the stored kv value into a `BookmarkSettings`, falling back per-field
 *  to the defaults on anything malformed. */
export function parseBookmarkSettings(raw: unknown): BookmarkSettings {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { ...DEFAULT_BOOKMARK_SETTINGS };
	}
	const r = raw as Record<string, unknown>;
	return {
		downloadContentDefault:
			typeof r.downloadContentDefault === "boolean"
				? r.downloadContentDefault
				: DEFAULT_BOOKMARK_SETTINGS.downloadContentDefault,
	};
}
