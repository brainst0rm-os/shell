/** Block types our Notes app actually owns. Lexical's own `__type` field
 *  on the built-in nodes ("paragraph", "heading", "list", etc.) is what
 *  serialization uses; this enum is for our `TURN_INTO_COMMAND` payloads
 *  and for slash-command actions — keeps every transform reference one
 *  place per CLAUDE.md (no raw `case "h1":` strings). */
export enum BlockType {
	Paragraph = "paragraph",
	Heading1 = "h1",
	Heading2 = "h2",
	Heading3 = "h3",
	BulletList = "bullet",
	NumberedList = "number",
	TodoList = "todo",
	Quote = "quote",
	Code = "code",
	Callout = "callout",
}

/** Toggle/collapsible block heading level. `Paragraph` is a plain
 *  toggle list; the heading variants are collapsible headings. One node,
 *  one CSS family — no separate toggle-heading node. */
export enum ToggleVariant {
	Paragraph = "paragraph",
	Heading1 = "h1",
	Heading2 = "h2",
	Heading3 = "h3",
}

/** Callout colour tone. Chrome (not user data), so it maps to shell
 *  state tokens — distinct from property vocabulary colours per
 *  [[vocabulary-colors-arent-tokens]]. `Neutral` is the default insert. */
export enum CalloutTone {
	Neutral = "neutral",
	Info = "info",
	Success = "success",
	Warn = "warn",
	Danger = "danger",
}
