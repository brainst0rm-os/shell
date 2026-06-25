/**
 * Shared node-label resolution + truncation. Extracted so the SVG renderer
 * and the Pixi DOM-overlay renderer derive the *same* label from the same
 * entity and apply the *same* hard character cap.
 *
 * Why this exists: the Pixi overlay used to call a private `labelFor` that
 * did **no** truncation while the `.graph-canvas__label` div had no CSS
 * rule — a long entity name overflowed unbounded across the canvas (a
 * silent prod regression after the 9.13.5 Pixi swap). The SVG renderer's
 * `labelFor` already capped at `NODE_LABEL_MAX_CHARS`; the two paths
 * diverged. One module, one cap, no divergence (DRY).
 *
 * The character cap is the model-level guard (deterministic, testable, no
 * DOM dependency). The render layer additionally ellipsises any residual
 * pixel overflow via `.graph-canvas__label` CSS — defence in depth, per
 * the [[long-strings-must-be-clipped]] convention (clip at the data layer
 * when possible AND at the render layer always).
 */

import type { EntityRow } from "../logic/in-memory-graph";

/** Hard character ceiling for a painted node label. A 48-glyph name is
 *  already wider than any sane node disc at default zoom; past it the
 *  label is noise. The CSS `max-width`/`text-overflow:ellipsis` rule is
 *  the pixel-precise second line of defence for whatever survives. */
export const NODE_LABEL_MAX_CHARS = 48;

/** The entity's display string before truncation: `name` → `title` → a
 *  short id prefix so a node is never anonymous. Mirrors the exact
 *  resolution both renderers used pre-extraction (`(name ?? title) ?? id`),
 *  so this change is *only* the missing truncation, never a label shift. */
export function rawNodeLabel(entity: EntityRow): string {
	const props = entity.properties as Record<string, unknown>;
	const raw = (props.name ?? props.title) as string | undefined;
	return raw ?? entity.id.slice(0, 8);
}

/** Resolve + hard-truncate a node label to at most `NODE_LABEL_MAX_CHARS`
 *  characters, appending an ellipsis when clipped. Trailing whitespace
 *  before the ellipsis is trimmed so we never render "foo …". */
export function nodeLabel(entity: EntityRow): string {
	const text = rawNodeLabel(entity);
	if (text.length <= NODE_LABEL_MAX_CHARS) return text;
	return `${text.slice(0, NODE_LABEL_MAX_CHARS - 1).trimEnd()}…`;
}
