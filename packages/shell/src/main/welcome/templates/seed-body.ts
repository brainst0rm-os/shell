/**
 * Shared body-authoring helpers for bundled Welcome-2 templates (9.3.5.V 7d).
 *
 * Extracted from `project-management.ts` at the third bundled template (the
 * DRY threshold the original file's comment called out): the seven templates
 * all author note bodies as the same minimal serialized-Lexical JSON, so the
 * `text` / `mention` / `body` builders live here once. `mention` produces the
 * inline decorator node the seeder plants verbatim — its `entityId` MUST match
 * another entity in the same manifest so the Graph paints a connected subgraph
 * with no dangling refs (the per-template tests assert this).
 *
 * `dayKey(now, offsetDays)` is the journal helper: a journal `Entry/v1` is
 * identified by a strict canonical `YYYY-MM-DD` title (see the journal app's
 * `parseJournalDateKey`), so journaling-template entries derive their title
 * from the injected `now` — keeping the whole template deterministic in `now`.
 */

import type { WelcomeBody } from "../welcome-content";

const DAY_MS = 86_400_000;

export { DAY_MS };

export type Inline =
	| { type: "text"; version: 1; format: 0; mode: "normal"; style: ""; text: string; detail: 0 }
	| { type: "mention"; version: 1; entityId: string; entityType: string; label: string };

export function text(value: string): Inline {
	return { type: "text", version: 1, format: 0, mode: "normal", style: "", text: value, detail: 0 };
}

export function mention(entityId: string, entityType: string, label: string): Inline {
	return { type: "mention", version: 1, entityId, entityType, label };
}

/** Build a serialized-editor-state body from paragraphs of inline runs. */
export function body(children: Inline[][]): WelcomeBody {
	return {
		root: {
			type: "root",
			version: 1,
			format: "",
			indent: 0,
			direction: null,
			children: children.map((inlines) => ({
				type: "paragraph",
				version: 1,
				format: "",
				indent: 0,
				direction: null,
				children: inlines,
			})),
		},
	} as WelcomeBody;
}

/** Canonical `YYYY-MM-DD` key for `now` shifted by `offsetDays`, using LOCAL
 *  date components — the journal app keys days locally (`dateKeyForJournal` +
 *  `parseJournalDateKey` anchor at local midnight), so a UTC key would title
 *  the "today" entry with tomorrow's date in a negative-UTC tz near midnight
 *  and surface it on the wrong day. Mirrors the shared Tasks/Calendar/Journal
 *  `dateKey` format exactly. */
export function dayKey(now: number, offsetDays = 0): string {
	const d = new Date(now + offsetDays * DAY_MS);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}
