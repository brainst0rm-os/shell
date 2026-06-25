/**
 * Demo dataset — synthesised journal entries for the 9.16.1.5 preview
 * drop. Each entry is StoredNote-shaped (title=`YYYY-MM-DD`, body is
 * plain text) so the projection logic that 9.16.2 will run against real
 * notes works identically against this in-memory list.
 *
 * Sparse on purpose — not every day has an entry; the renderer must
 * handle gaps. Entries are seeded relative to a deterministic anchor
 * (2026-05-14) so test snapshots stay stable.
 *
 * Replaced wholesale by `services.vaultEntities.list` filtered to
 * `Note/v1` at 9.16.2 — this file deletes then.
 */

import { HabitId, MoodId } from "../logic/check-in";
import { dateKeyForJournal } from "../logic/journal-keys";
import type { NoteLike } from "../logic/journal-projection";

/** Anchor date — every entry's offset is days BEFORE this date. */
const ANCHOR = new Date(2026, 4, 14);

const ENTRIES: Array<{
	daysAgo: number;
	body: string;
	mood?: MoodId;
	habits?: HabitId[];
}> = [
	{
		daysAgo: 0,
		body:
			"Shipped the SH-9 self-hosting subjects today. The graph now paints the implementation plan as stage clusters. Felt good to see iterations clustering naturally.",
		mood: MoodId.Great,
		habits: [HabitId.Exercise, HabitId.Read],
	},
	{
		daysAgo: 1,
		body:
			"Long afternoon polishing the Database list view. The bordered-input focus ring kept stacking outside the border; landed `outline-offset: -1px` everywhere. Three places now correct.",
		mood: MoodId.Good,
		habits: [HabitId.Read],
	},
	{
		daysAgo: 2,
		body:
			"Couldn't focus on code. Walked to the park instead. Saw two crows arguing over a sandwich crust. Felt strangely cheered up.",
		mood: MoodId.Ok,
		habits: [HabitId.Outside],
	},
	{
		daysAgo: 4,
		body:
			"Wrote tests for the calendar grid math. Off-by-one on the leading-edge May 2026 cells until I realised the anchor week was off. Fixed.",
		mood: MoodId.Good,
	},
	{
		daysAgo: 5,
		body: "Quiet morning. Coffee, mountains, code.",
		mood: MoodId.Good,
		habits: [HabitId.Outside, HabitId.SleepWell],
	},
	{
		daysAgo: 6,
		body:
			"Reviewed the Whiteboard scaffold. The OQ-WB-2 resolution (four-compass handles) holds up cleanly under the path-math tests. Pixi swap can lean on the same algorithm.",
	},
	{
		daysAgo: 8,
		body:
			"Migraine — barely got out of bed. No work today. Felt frustrated and then relieved I could just stop.",
		mood: MoodId.Bad,
	},
	{
		daysAgo: 10,
		body:
			"Calendar preview drop landed. The `ScheduledItem` keystone (unified shape across Event/Task/Note/Birthday) was the right call — renderer doesn't branch on source.",
	},
	{
		daysAgo: 11,
		body:
			"Resolved OQ-TK-2 — first-class Project/v1 entity, Tasks-app-owned. The temptation to fold it into Database's lists was real but Tasks needs to own its own object graph.",
	},
	{
		daysAgo: 13,
		body:
			"Read about a peer team's typing protocol for collaborative editors. Yjs-with-presence is still the right primitive for us.",
	},
	{
		daysAgo: 14,
		body:
			"Started thinking about the marketplace MVP. Five panels: Catalog / Theme / App / Featured / Account. Wallet + dev portal stay v2.",
	},
	{
		daysAgo: 15,
		body: "Friend visited. Cooked together. Didn't open the laptop. Recommended.",
	},
	{
		daysAgo: 17,
		body:
			"Pinned down OQ-WB-1 (Whiteboard nodes and edges as separate entities). The visual debt of folding edges into the node entity is real but the integrity cost is realer.",
	},
	{
		daysAgo: 18,
		body:
			"Long day. Three apps shipped scaffolds (Bookmarks, Whiteboard, Journal). The 9.x.1 pattern is paying off.",
	},
	{
		daysAgo: 20,
		body:
			"Notes B5.6a — title folded into Lexical state as TitleNode. The textarea workaround is gone; title accepts marks + mentions for free. Big quality-of-life win.",
	},
	{
		daysAgo: 22,
		body:
			"Reviewed the 49-self-hosting doc end-to-end. The dev-repo direction was the wrong instinct. The seeding approach is cleaner: write the plan into the vault as entities, render through normal app surfaces.",
	},
	{
		daysAgo: 24,
		body:
			"Wrote no code today. Read three papers on operational transforms. Came away appreciating Yjs more than ever.",
	},
	{
		daysAgo: 26,
		body:
			"Database app polish: list/grid/timeline + inspector + space tokens + transform anims. Smoothest commit in weeks.",
	},
	{
		daysAgo: 28,
		body: "Slept badly. Made coffee. Made more coffee. Wrote one test. Quit early.",
	},
	{
		daysAgo: 30,
		body:
			"Graph app — landed zoom + pan + LOD thresholds. Below k<0.5 the arrows disappear; below k<1 the icons swap for plain discs. Reading the graph at three scales feels natural now.",
	},
	{
		daysAgo: 33,
		body:
			"Spent the afternoon at the bookstore. Bought one book on type design (Bringhurst — finally). Came home and updated the typography settings in the Settings panel.",
	},
	{
		daysAgo: 35,
		body:
			"Vocabulary colors aren't UI tokens — they belong to the vocabulary entry, set via Properties UI. Memory landed.",
	},
	{
		daysAgo: 37,
		body:
			"First-party apps roadmap expanded: Tasks, Calendar, Journal, Whiteboard, Bookmarks, Bin, Preview, Books. Eight new apps. Excited, slightly daunted.",
	},
	{
		daysAgo: 40,
		body: "Took the day off. Long walk. No screens till evening. Watched the rain.",
	},
	{
		daysAgo: 43,
		body:
			"Composable property model landed end-to-end. Collapsing Select / MultiSelect / Url / Email / Phone / File / Link into Text + EntityRef + modifiers turned out to be the right move. Smaller surface, more expressive.",
	},
	{
		daysAgo: 46,
		body:
			"Read the latest migration design from a peer team. Good ideas. Borrowing the entity-aware migration step for our own 9.3 upgrade.",
	},
	{
		daysAgo: 49,
		body:
			"Quiet day. Refactored the broker context wiring. The closures-once-at-startup approach holds up.",
	},
	{
		daysAgo: 52,
		body:
			"Cooked. Walked. Wrote three OQs about the AI broker (Stage 11). Decided not to start until Stage 9 closes.",
	},
];

/** Build the in-memory journal dataset. Returns NoteLike rows the
 *  projection layer consumes verbatim. */
export function buildJournalDemo(): NoteLike[] {
	return ENTRIES.map(({ daysAgo, body, mood, habits }, i) => {
		const d = new Date(
			ANCHOR.getFullYear(),
			ANCHOR.getMonth(),
			ANCHOR.getDate() - daysAgo,
			0,
			0,
			0,
			0,
		);
		return {
			id: `demo-journal-${i + 1}`,
			title: dateKeyForJournal(d),
			body,
			...(mood ? { mood } : {}),
			...(habits ? { habits } : {}),
		};
	});
}

/** Today's anchor — used by the renderer to default `focus` and to
 *  evaluate "Today" highlighting. Exposed for tests + the renderer so
 *  both agree on "now" without a wall-clock dependency. */
export function demoAnchorDate(): Date {
	return new Date(ANCHOR.getFullYear(), ANCHOR.getMonth(), ANCHOR.getDate());
}
