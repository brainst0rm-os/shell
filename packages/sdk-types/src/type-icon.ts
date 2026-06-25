/**
 * Canonical entity-type → default icon resolver.
 *
 * Per docs/foundations/39-universal-icons.md §"Per-object icons
 * everywhere": an app renders an object's OWN `properties.icon`; the
 * entity *type* supplies the icon only as a **fallback** when the object
 * has none. That fallback must be (a) complete — every first-party type
 * resolves to something meaningful — and (b) shared, so Graph, Database,
 * Files, etc. don't each carry a private, divergent, half-populated map
 * (the Graph app's old `typeGlyph` only knew person/city/school/note/
 * file and rendered every Task/Project/Event as an anonymous dot — the
 * recurring "graph icons missing" report).
 *
 * This is the ONE place that mapping lives. Returns a universal `Icon`
 * (Emoji kind — platform-rendered, no asset pipeline, the same shape an
 * object's own emoji icon uses, so consumers route it through their
 * existing icon path unchanged).
 *
 * Pure + dependency-free (sdk-types is the canonical home for the icon
 * model). Resolution: exact id first, then suffix match on the
 * `<ns>/<Name>/<v>` tail so any namespaced variant still resolves, then
 * a visible generic fallback (never an invisible/empty glyph).
 */

import { type Icon, IconKind } from "./icon";

const emoji = (value: string): Icon => ({ kind: IconKind.Emoji, value });

/** Exact canonical first-party type ids. Suffix matching covers the
 *  rest, but pinning the canonical ids keeps the common path a single
 *  map lookup and documents the first-party set. */
const EXACT: Readonly<Record<string, Icon>> = {
	"brainstorm/Task/v1": emoji("📋"),
	"brainstorm/Project/v1": emoji("📁"),
	"brainstorm/Event/v1": emoji("📅"),
	"brainstorm/Person/v1": emoji("👤"),
	"io.brainstorm.notes/Note/v1": emoji("📝"),
	"io.brainstorm.journal/Entry/v1": emoji("📓"),
	"brainstorm/Iteration/v1": emoji("🔄"),
	"brainstorm/OpenQuestion/v1": emoji("❓"),
	"brainstorm/Stage/v1": emoji("🚩"),
	"brainstorm/DesignDoc/v1": emoji("📐"),
};

/** Suffix → emoji. Order matters only where one tail is a substring of
 *  another (none here). Keep alphabetical-ish for scanability. */
const SUFFIX: ReadonlyArray<readonly [string, Icon]> = [
	["article", emoji("📰")],
	["book", emoji("📚")],
	["bookmark", emoji("🔖")],
	["calendar", emoji("📆")],
	["city", emoji("🏙️")],
	["designdoc", emoji("📐")],
	["event", emoji("📅")],
	["file", emoji("📄")],
	["folder", emoji("📁")],
	["graph", emoji("🕸️")],
	["iteration", emoji("🔄")],
	["journal", emoji("📓")],
	["list", emoji("🗂️")],
	["movie", emoji("🎬")],
	["note", emoji("📝")],
	["openquestion", emoji("❓")],
	["person", emoji("👤")],
	["photo", emoji("🏞️")],
	["project", emoji("📁")],
	["school", emoji("🏫")],
	["stage", emoji("🚩")],
	["task", emoji("📋")],
	["trip", emoji("✈️")],
	["whiteboard", emoji("🖼️")],
];

/** Visible neutral fallback for a genuinely unknown type — a labelled
 *  box, never an empty/near-invisible mark. */
export const GENERIC_TYPE_ICON: Icon = emoji("📦");

/**
 * The default icon for an entity type. Never returns null — an unknown
 * type still gets `GENERIC_TYPE_ICON` so a node/row is never iconless.
 */
export function defaultIconForType(typeId: string): Icon {
	const exact = EXACT[typeId];
	if (exact) return exact;
	const t = typeId.toLowerCase();
	const has = (s: string): boolean => t.includes(`/${s}/`) || t.endsWith(`/${s}`);
	for (const [suffix, icon] of SUFFIX) {
		if (has(suffix)) return icon;
	}
	return GENERIC_TYPE_ICON;
}
