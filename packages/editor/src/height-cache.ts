/**
 * Per-editor height cache for top-level blocks (docs/editing/52 §shared
 * mechanics). A `Map<id, measured-px>` populated by a single shared
 * `ResizeObserver` over every block element the editor stamps. The
 * cache feeds both Phase-1's `contain-intrinsic-size` (so the browser
 * skip-renders offscreen blocks with the right reserved height — the
 * scrollbar geometry stays correct) and Phase-2's prefix-sum scroll
 * geometry (built on top of the same map). Pure DOM, no React.
 *
 * Unmeasured blocks get a typed estimate (`paragraph` ≈ one line at body
 * size; headings at their canonical sizes; code at code-line-height;
 * `embed` at a default box). Estimates are intentionally on the low side
 * of "realistic" — overshooting reserves too much scrollback and the
 * scrollbar jumps on first measurement; the constants are exported so
 * tests can pin them.
 */

export enum BlockKind {
	Paragraph = "paragraph",
	HeadingH1 = "heading-h1",
	HeadingH2 = "heading-h2",
	HeadingH3 = "heading-h3",
	Code = "code",
	Embed = "embed",
}

export const ESTIMATED_LINE_HEIGHT_PX = 24;
export const ESTIMATED_HEADING_H1_PX = 56;
export const ESTIMATED_HEADING_H2_PX = 44;
export const ESTIMATED_HEADING_H3_PX = 32;
export const ESTIMATED_CODE_LINE_HEIGHT_PX = 20;
export const ESTIMATED_EMBED_PX = 240;
export const ESTIMATED_PARAGRAPH_CHARS_PER_LINE = 80;

export type HeightCache = {
	get(id: string): number | undefined;
	observe(id: string, el: Element): () => void;
	estimate(kind: BlockKind, hint?: number): number;
	size(): number;
	dispose(): void;
};

export function createHeightCache(): HeightCache {
	const heights = new Map<string, number>();
	const elementToId = new WeakMap<Element, string>();
	const idToElement = new Map<string, Element>();

	const ObserverImpl: typeof ResizeObserver | undefined =
		typeof ResizeObserver !== "undefined" ? ResizeObserver : undefined;

	let observer: ResizeObserver | null = null;
	if (ObserverImpl) {
		observer = new ObserverImpl((entries) => {
			for (const entry of entries) {
				const id = elementToId.get(entry.target);
				if (!id) continue;
				const height =
					entry.borderBoxSize?.[0]?.blockSize ??
					entry.contentRect.height ??
					(entry.target as HTMLElement).offsetHeight ??
					0;
				if (height > 0) heights.set(id, height);
			}
		});
	}

	return {
		get(id) {
			return heights.get(id);
		},
		observe(id, el) {
			const prevElement = idToElement.get(id);
			if (prevElement && prevElement !== el && observer) {
				observer.unobserve(prevElement);
			}
			idToElement.set(id, el);
			elementToId.set(el, id);
			observer?.observe(el);
			return () => {
				const current = idToElement.get(id);
				if (current === el) {
					idToElement.delete(id);
					if (observer) observer.unobserve(el);
				}
			};
		},
		estimate(kind, hint) {
			switch (kind) {
				case BlockKind.HeadingH1:
					return ESTIMATED_HEADING_H1_PX;
				case BlockKind.HeadingH2:
					return ESTIMATED_HEADING_H2_PX;
				case BlockKind.HeadingH3:
					return ESTIMATED_HEADING_H3_PX;
				case BlockKind.Code: {
					const lines = Math.max(1, hint ?? 1);
					return lines * ESTIMATED_CODE_LINE_HEIGHT_PX;
				}
				case BlockKind.Embed:
					return hint && hint > 0 ? hint : ESTIMATED_EMBED_PX;
				case BlockKind.Paragraph: {
					const chars = Math.max(0, hint ?? 0);
					const lines = Math.max(1, Math.ceil(chars / ESTIMATED_PARAGRAPH_CHARS_PER_LINE));
					return lines * ESTIMATED_LINE_HEIGHT_PX;
				}
				default:
					return ESTIMATED_LINE_HEIGHT_PX;
			}
		},
		size() {
			return heights.size;
		},
		dispose() {
			observer?.disconnect();
			heights.clear();
			idToElement.clear();
		},
	};
}
