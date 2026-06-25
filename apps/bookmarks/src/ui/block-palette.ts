/**
 * The Bookmarks detail body's deliberate slash-menu palette (F-070 rung (b),
 * 9.18.3c): the subset of the shared block catalogue — in order — that a saved
 * link's reading notes / annotations actually reach for.
 *
 * Like Journal, it deliberately drops the 2- and 3-column layouts
 * (`block.columns2`/`block.columns3`): a multi-column layout is backwards for
 * a link annotation. Headings → lists → quote / callout / code carry the
 * note-taking shape; a `table` stays for a comparison/spec capture and a
 * `divider`/`toggle` for sectioning a longer read. Every id here must be a
 * real `createStandardBlockCommands` id (asserted in the test) so a typo never
 * silently drops a row.
 */
export const BOOKMARK_BLOCK_PALETTE: readonly string[] = [
	"block.paragraph",
	"block.heading1",
	"block.heading2",
	"block.heading3",
	"block.bulletList",
	"block.numberedList",
	"block.todoList",
	"block.quote",
	"block.callout",
	"block.code",
	"block.divider",
	"block.toggle",
	"block.table",
];
