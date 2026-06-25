/**
 * Pure tone selector for the shared `<EmptyState>` so the class string lives
 * in one place (mirrors `count-badge/format-count.ts`). No DOM, no React.
 */

/** Visual weight of an empty state. Enum, not a bare literal, per the
 *  no-string-discriminator convention. */
export enum EmptyStateTone {
	/** Full-pane first-impression empty — a large accent-tinted glyph chip
	 *  over a title + hint. The default; used when the empty IS the surface
	 *  (Preview's stage, Books' reader pane). */
	Hero = "hero",
	/** In-panel list/section empty — a small dim glyph, no chip. Used when
	 *  the empty sits inside other chrome (Automations' runs/reminders lists). */
	Compact = "compact",
}

/** The class string for an empty state at a given tone (+ optional extra
 *  layout classes the consumer owns — never re-skin the surface). */
export function emptyStateClassName(tone: EmptyStateTone, extra?: string): string {
	const base = `bs-empty-state bs-empty-state--${tone}`;
	return extra ? `${base} ${extra}` : base;
}
