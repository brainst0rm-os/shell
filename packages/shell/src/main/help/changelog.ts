/**
 * Feedback-3 — bundled curated changelog. Build-time-included (no
 * network, no runtime feed) per
 * §Help, feedback & changelog. The renderer's Settings → What's new
 * view + the dashboard auto-popup both consume the parsed shape via
 * IPC, then render with a shared editorial-page component.
 *
 * v2 (2026-05-24): Replaced the flat `notes: {category, text}[]` shape
 * with a per-release block body so a release reads like a small
 * editorial page — hero (icon + title + version·date + summary)
 * followed by sectioned content (Heading1/2/3, Paragraph, Bullet,
 * Callout) with inline marks (Bold, Highlight) on TextRuns.
 *
 * The model intentionally stays narrow: no images, no nested blocks,
 * no Markdown parsing — TextRuns are structured so the renderer never
 * touches innerHTML. The shape is a build-time artifact, so any parse
 * failure is a release-blocking bug (fail loud).
 */

/** Inline mark on a TextRun. String enum so the value IS the wire form
 *  and the renderer can dispatch on a stable identifier rather than
 *  re-parsing display strings. Kept minimal: Bold for emphasis,
 *  Highlight for short kbd-like inline tokens (shortcut keys, paths,
 *  enum names). Italic was rejected for v2 — emphasis goes through Bold
 *  to keep the visual rhythm consistent. */
export enum TextMark {
	/** Renders as `<strong>` — strong emphasis inside flowing copy. */
	Bold = "bold",
	/** Renders as a tinted inline pill (`var(--color-shape-tertiary)`
	 *  background, rounded). Use for keys (`⌘+K`), enum names
	 *  (`Block Protocol`), code-ish terms. */
	Highlight = "highlight",
}

/** One run of styled text inside a block. The renderer maps marks →
 *  wrapping elements, never inline HTML. */
export type TextRun = {
	/** Plain text — no Markdown, no HTML. Must be non-empty. */
	readonly text: string;
	/** Optional marks. Order is irrelevant; duplicates are rejected at
	 *  parse time to keep the wire form canonical. */
	readonly marks?: readonly TextMark[];
};

/** The kinds of blocks a release body can hold. String enum: the value
 *  IS the wire form. */
export enum ChangelogBlockKind {
	/** Top-level section heading inside a release. */
	Heading1 = "h1",
	/** Sub-section heading — use when an H1 section needs grouping. */
	Heading2 = "h2",
	/** Inline-grade heading — bolded line break, NOT a section divider. */
	Heading3 = "h3",
	/** Flowing prose. */
	Paragraph = "p",
	/** A list item — siblings auto-group into a single visual list. */
	Bullet = "li",
	/** Tinted attention block prefixed by an emoji icon. */
	Callout = "callout",
}

export type ChangelogBlock =
	| { readonly kind: ChangelogBlockKind.Heading1; readonly text: readonly TextRun[] }
	| { readonly kind: ChangelogBlockKind.Heading2; readonly text: readonly TextRun[] }
	| { readonly kind: ChangelogBlockKind.Heading3; readonly text: readonly TextRun[] }
	| { readonly kind: ChangelogBlockKind.Paragraph; readonly text: readonly TextRun[] }
	| { readonly kind: ChangelogBlockKind.Bullet; readonly text: readonly TextRun[] }
	| {
			readonly kind: ChangelogBlockKind.Callout;
			/** Emoji prefix (e.g. `⚠️`, `🛠`). Non-empty. */
			readonly icon: string;
			readonly text: readonly TextRun[];
	  };

/** One release entry — reads as a small editorial page. */
export type ChangelogRelease = {
	/** Semver-ish version string. Compared via {@link compareVersions}. */
	readonly version: string;
	/** ISO date `YYYY-MM-DD`. The renderer formats with Intl. */
	readonly date: string;
	/** Emoji shown as the hero glyph. Non-empty (one or more grapheme
	 *  clusters); the parser doesn't enforce single-emoji because the
	 *  underlying grapheme rules are heavier than this validator wants
	 *  to ship. */
	readonly icon: string;
	/** Short release title ("Pre-alpha development build"). */
	readonly title: string;
	/** Optional one-paragraph blurb shown directly under the title in
	 *  the hero. Plain text. */
	readonly summary?: string;
	/** Editorial body. Must contain at least one block. */
	readonly body: readonly ChangelogBlock[];
};

/** Parsed changelog. `releases` is **newest-first** (the parser sorts;
 *  the bundled JSON's order is therefore free to stay chronological for
 *  diff readability). */
export type Changelog = {
	readonly format: typeof CHANGELOG_FORMAT;
	readonly releases: readonly ChangelogRelease[];
};

export const CHANGELOG_FORMAT = "brainstorm/changelog/v2";

/** Validate + normalise a raw `unknown` (typically `JSON.parse(file)`)
 *  into a typed {@link Changelog}. Throws with a descriptive message
 *  when the shape is wrong — pre-bundled file, so any failure is a
 *  build-time bug, not a runtime user issue. */
export function parseChangelog(raw: unknown): Changelog {
	if (!raw || typeof raw !== "object") {
		throw new Error("changelog: expected an object");
	}
	const root = raw as { format?: unknown; releases?: unknown };
	if (root.format !== CHANGELOG_FORMAT) {
		throw new Error(
			`changelog: unsupported format ${JSON.stringify(root.format)} (expected ${CHANGELOG_FORMAT})`,
		);
	}
	if (!Array.isArray(root.releases)) {
		throw new Error("changelog: releases must be an array");
	}
	const releases = root.releases.map(parseRelease);
	releases.sort((a, b) => -compareVersions(a.version, b.version));
	return { format: CHANGELOG_FORMAT, releases };
}

function parseRelease(raw: unknown, index: number): ChangelogRelease {
	if (!raw || typeof raw !== "object") {
		throw new Error(`changelog: release ${index} must be an object`);
	}
	const r = raw as {
		version?: unknown;
		date?: unknown;
		icon?: unknown;
		title?: unknown;
		summary?: unknown;
		body?: unknown;
	};
	const version = asNonEmptyString(r.version, `release ${index} version`);
	const date = asNonEmptyString(r.date, `release ${index} date`);
	if (!ISO_DATE_RE.test(date)) {
		throw new Error(`changelog: release ${index} date "${date}" must be ISO YYYY-MM-DD`);
	}
	const icon = asNonEmptyString(r.icon, `release ${index} icon`);
	const title = asNonEmptyString(r.title, `release ${index} title`);
	const summary =
		r.summary === undefined ? undefined : asNonEmptyString(r.summary, `release ${index} summary`);
	if (!Array.isArray(r.body)) {
		throw new Error(`changelog: release ${index} body must be an array`);
	}
	if (r.body.length === 0) {
		throw new Error(`changelog: release ${index} body must have at least one block`);
	}
	const body = r.body.map((b, i) => parseBlock(b, index, i));
	const release: ChangelogRelease = { version, date, icon, title, body };
	return summary === undefined ? release : { ...release, summary };
}

const BLOCK_KIND_VALUES = new Set<string>(Object.values(ChangelogBlockKind));

function parseBlock(raw: unknown, releaseIndex: number, blockIndex: number): ChangelogBlock {
	if (!raw || typeof raw !== "object") {
		throw new Error(`changelog: release ${releaseIndex} block ${blockIndex} must be an object`);
	}
	const b = raw as { kind?: unknown; text?: unknown; icon?: unknown };
	if (typeof b.kind !== "string" || !BLOCK_KIND_VALUES.has(b.kind)) {
		throw new Error(
			`changelog: release ${releaseIndex} block ${blockIndex} kind ${JSON.stringify(b.kind)} must be one of ${[
				...BLOCK_KIND_VALUES,
			]
				.sort()
				.join(", ")}`,
		);
	}
	const kind = b.kind as ChangelogBlockKind;
	const text = parseRichText(b.text, releaseIndex, blockIndex);
	if (kind === ChangelogBlockKind.Callout) {
		const icon = asNonEmptyString(
			b.icon,
			`release ${releaseIndex} block ${blockIndex} (callout) icon`,
		);
		return { kind, icon, text };
	}
	return { kind, text };
}

/** Accept either a plain string (sugar for a single unmarked run) or an
 *  array of TextRuns. Returns a non-empty array of normalised runs. */
function parseRichText(raw: unknown, releaseIndex: number, blockIndex: number): readonly TextRun[] {
	if (typeof raw === "string") {
		if (raw.length === 0) {
			throw new Error(
				`changelog: release ${releaseIndex} block ${blockIndex} text must be a non-empty string`,
			);
		}
		return [{ text: raw }];
	}
	if (!Array.isArray(raw)) {
		throw new Error(
			`changelog: release ${releaseIndex} block ${blockIndex} text must be a string or an array of runs`,
		);
	}
	if (raw.length === 0) {
		throw new Error(
			`changelog: release ${releaseIndex} block ${blockIndex} text must have at least one run`,
		);
	}
	return raw.map((r, i) => parseRun(r, releaseIndex, blockIndex, i));
}

const MARK_VALUES = new Set<string>(Object.values(TextMark));

function parseRun(
	raw: unknown,
	releaseIndex: number,
	blockIndex: number,
	runIndex: number,
): TextRun {
	if (!raw || typeof raw !== "object") {
		throw new Error(
			`changelog: release ${releaseIndex} block ${blockIndex} run ${runIndex} must be an object`,
		);
	}
	const r = raw as { text?: unknown; marks?: unknown };
	const text = asNonEmptyString(
		r.text,
		`release ${releaseIndex} block ${blockIndex} run ${runIndex} text`,
	);
	if (r.marks === undefined) {
		return { text };
	}
	if (!Array.isArray(r.marks)) {
		throw new Error(
			`changelog: release ${releaseIndex} block ${blockIndex} run ${runIndex} marks must be an array`,
		);
	}
	const marks: TextMark[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < r.marks.length; i++) {
		const m = r.marks[i];
		if (typeof m !== "string" || !MARK_VALUES.has(m)) {
			throw new Error(
				`changelog: release ${releaseIndex} block ${blockIndex} run ${runIndex} mark ${i} ${JSON.stringify(
					m,
				)} must be one of ${[...MARK_VALUES].sort().join(", ")}`,
			);
		}
		if (seen.has(m)) {
			throw new Error(
				`changelog: release ${releaseIndex} block ${blockIndex} run ${runIndex} mark ${JSON.stringify(
					m,
				)} duplicated`,
			);
		}
		seen.add(m);
		marks.push(m as TextMark);
	}
	return marks.length === 0 ? { text } : { text, marks };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asNonEmptyString(raw: unknown, label: string): string {
	if (typeof raw !== "string" || raw.length === 0) {
		throw new Error(`changelog: ${label} must be a non-empty string`);
	}
	return raw;
}

/** Compare two semver-ish version strings. Splits on `.`, compares
 *  numerically when both segments parse as integers, falls back to
 *  lexicographic. Returns negative when `a < b`, zero on equal,
 *  positive when `a > b`. Bare suffix segments (`1.2.0-rc1`) compare
 *  lexicographically against the equivalent stripped version. */
export function compareVersions(a: string, b: string): number {
	const as = a.split(".");
	const bs = b.split(".");
	const len = Math.max(as.length, bs.length);
	for (let i = 0; i < len; i++) {
		const aPart = as[i] ?? "0";
		const bPart = bs[i] ?? "0";
		const aNum = Number.parseInt(aPart, 10);
		const bNum = Number.parseInt(bPart, 10);
		if (
			Number.isFinite(aNum) &&
			Number.isFinite(bNum) &&
			String(aNum) === aPart &&
			String(bNum) === bPart
		) {
			if (aNum !== bNum) return aNum - bNum;
			continue;
		}
		const lex = aPart.localeCompare(bPart);
		if (lex !== 0) return lex;
	}
	return 0;
}

/** Filter `changelog.releases` to entries strictly newer than
 *  `lastSeenVersion`. Returns every release when `lastSeenVersion` is
 *  null (the user hasn't yet seen anything). Used by the auto-popup
 *  path to decide whether to surface "what's new". */
export function unseenReleases(
	changelog: Changelog,
	lastSeenVersion: string | null,
): readonly ChangelogRelease[] {
	if (lastSeenVersion === null) return changelog.releases;
	return changelog.releases.filter((r) => compareVersions(r.version, lastSeenVersion) > 0);
}
