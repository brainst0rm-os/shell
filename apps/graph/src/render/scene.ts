/**
 * Scene orchestrator — given a pattern, an in-memory graph, and a cutoff
 * timestamp, computes:
 *   - The matched node/edge set (via the pattern matcher).
 *   - **Filters entities/edges by `created_at <= cutoff` and drops the rest
 *     from the scene entirely.** Timeline playback is therefore a real
 *     topology change every tick — the layout reconciler sees new ids,
 *     reheats the force engine, and the graph visibly builds as time
 *     advances instead of fading existing nodes
 *     in via opacity. The opacity-only path silently kept the force sim
 *     cool, so no rearrangement ever happened and playback looked dead.
 *   - Picks per-subject colors.
 *
 * Pure: no DOM, no SVG. The renderer takes the returned `RenderNode[]` /
 * `RenderEdge[]` and draws them.
 */

import type { EntityRow, InMemoryGraph } from "../logic/in-memory-graph";
import { LinkCategory, linkCategory } from "../logic/link-reason";
import { type MatchResult, matchPattern } from "../logic/match-pattern";
import { HistoryReveal } from "../types/graph-view";
import { type Icon, IconKind } from "../types/icon";
import type { GraphPattern } from "../types/pattern";
import { iconKey } from "./icon-source";
import type { RenderEdge, RenderNode } from "./svg-renderer";

/** Recognised icon-kind values, used to validate the loosely-typed
 *  `entity.properties.icon` blob coming off the in-memory graph. */
const ICON_KINDS: ReadonlySet<string> = new Set<string>([
	IconKind.Pack,
	IconKind.Emoji,
	IconKind.Image,
]);

/** Fallback palette used when the document hasn't pushed graph tokens yet
 *  (e.g. running the app standalone via `vite dev` without the shell
 *  preload). Real values come from `--graph-subject-1..8` at runtime via
 *  `resolveGraphTheme`. */
const FALLBACK_SUBJECT_PALETTE = [
	"#a78bfa",
	"#60a5fa",
	"#34d399",
	"#fbbf24",
	"#f87171",
	"#22d3ee",
	"#f472b6",
	"#a3e635",
] as const;

/** Opaque generic node colour for a type with no palette slot — a node is
 *  never painted semi-transparent (transparency on hundreds of overlapping
 *  discs read as visual mud). Opacity is reserved for the history-reveal
 *  fade, nothing else. */
const FALLBACK_UNMATCHED = "#9aa3b2";
/** Edge colours are opaque too; edge *presence* is carried by the alpha
 *  applied in `buildScene` (a single base level), not by a washed-out
 *  colour. Matched edges (active pattern) sit a touch brighter. */
const FALLBACK_EDGE_MATCHED = "#8b85ff";
const FALLBACK_EDGE_UNMATCHED = "#b9c0cc";
/** Per-reason edge colours (unmatched state) so an edge's *why* reads at a
 *  glance: editor links blue, property references neutral grey (the
 *  structural skeleton), shared attributes a muted violet (a softer,
 *  inferred signal). Overridable via `--graph-edge-{body,reference,shared}`. */
const FALLBACK_EDGE_BODY = "#8b9cff";
const FALLBACK_EDGE_REFERENCE = "#b9c0cc";
const FALLBACK_EDGE_SHARED = "#b9a3d6";

export type GraphTheme = {
	subjectPalette: ReadonlyArray<string>;
	unmatched: string;
	edge: {
		matched: string;
		unmatched: string;
		body: string;
		reference: string;
		shared: string;
	};
};

export const FALLBACK_GRAPH_THEME: GraphTheme = {
	subjectPalette: FALLBACK_SUBJECT_PALETTE,
	unmatched: FALLBACK_UNMATCHED,
	edge: {
		matched: FALLBACK_EDGE_MATCHED,
		unmatched: FALLBACK_EDGE_UNMATCHED,
		body: FALLBACK_EDGE_BODY,
		reference: FALLBACK_EDGE_REFERENCE,
		shared: FALLBACK_EDGE_SHARED,
	},
};

/** Read the active graph palette from CSS custom properties pushed by the
 *  shell preload. Falls back to the constants above when a var is missing
 *  (standalone-dev case) so the renderer never paints transparent. */
export function resolveGraphTheme(): GraphTheme {
	if (typeof document === "undefined") return FALLBACK_GRAPH_THEME;
	const cs = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string): string => {
		const v = cs.getPropertyValue(name).trim();
		return v.length > 0 ? v : fallback;
	};
	const palette: string[] = [];
	for (let i = 1; i <= 8; i += 1) {
		palette.push(read(`--graph-subject-${i}`, FALLBACK_SUBJECT_PALETTE[(i - 1) % 8] as string));
	}
	return {
		subjectPalette: palette,
		unmatched: read("--graph-unmatched", FALLBACK_UNMATCHED),
		edge: {
			matched: read("--graph-edge-matched", FALLBACK_EDGE_MATCHED),
			unmatched: read("--graph-edge-unmatched", FALLBACK_EDGE_UNMATCHED),
			body: read("--graph-edge-body", FALLBACK_EDGE_BODY),
			reference: read("--graph-edge-reference", FALLBACK_EDGE_REFERENCE),
			shared: read("--graph-edge-shared", FALLBACK_EDGE_SHARED),
		},
	};
}

/** Edge colour for a link reason category (unmatched state). */
export function edgeColorForCategory(category: LinkCategory, theme: GraphTheme): string {
	switch (category) {
		case LinkCategory.BodyLink:
			return theme.edge.body;
		case LinkCategory.PropertyReference:
			return theme.edge.reference;
		case LinkCategory.SharedAttribute:
			return theme.edge.shared;
	}
}

/** First-party object type → fixed palette slot. Colour encodes an
 *  object's *type* (a Task is always palette[1], a Note always palette[0]),
 *  so the graph reads as a type legend that stays stable across sessions
 *  and vaults instead of the old pattern-match colouring (which left most
 *  nodes an ambiguous grey and only the active subject coloured). Suffix
 *  match on the `<ns>/<Name>/<v>` tail, mirroring `defaultIconForType`, so
 *  namespaced variants resolve. Types not listed hash deterministically
 *  into the same palette below. */
const TYPE_PALETTE_SLOT: ReadonlyArray<readonly [string, number]> = [
	["note", 0],
	["task", 1],
	["project", 2],
	["folder", 2],
	["event", 3],
	["calendar", 3],
	["person", 4],
	["file", 5],
	["iteration", 6],
	["openquestion", 7],
	["designdoc", 2],
	["stage", 3],
	["journal", 0],
	["whiteboard", 6],
];

/** FNV-1a — a cheap, stable string hash so an unlisted type always lands
 *  on the same palette slot (same colour every render, no flicker). */
function hashType(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i += 1) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Opaque per-type node colour. An icon-less node still renders a solid
 *  disc in its type's colour — we never fabricate a type-derived *glyph*
 *  (see `resolveIcon`), but colour-by-type gives every node a meaningful
 *  default fill. First-party types pin to a fixed slot; everything else
 *  hashes deterministically into the palette. */
export function colorForType(typeId: string, theme: GraphTheme): string {
	const palette = theme.subjectPalette;
	if (palette.length === 0) return theme.unmatched;
	const t = typeId.toLowerCase();
	for (const [suffix, slot] of TYPE_PALETTE_SLOT) {
		if (t === suffix || t.includes(`/${suffix}/`) || t.endsWith(`/${suffix}`)) {
			return palette[slot % palette.length] ?? theme.unmatched;
		}
	}
	return palette[hashType(t) % palette.length] ?? theme.unmatched;
}

/** Base opacity for an edge in the default view. Opaque colour + this
 *  single alpha keeps the connective web legible (the old
 *  `rgba(...,0.3) × 0.35` ≈ 0.1 effective made edges all but invisible at
 *  survey zoom, which is most of why the graph read as loose confetti). */
const EDGE_BASE_ALPHA = 0.6;
/** Active-pattern edges sit brighter so a matched sub-graph still pops. */
const EDGE_MATCHED_ALPHA = 0.9;

/** With `showUnmatched` on, entities outside the pattern stay in the scene
 *  but recede to this alpha. Without the dim, matched and unmatched nodes
 *  were pixel-identical (colour is by type, not by match), so narrowing the
 *  pattern changed *nothing* on screen — the "filters don't work" report.
 *  Dim, don't hide: `showUnmatched=false` is the hide path. */
export const UNMATCHED_NODE_DIM = 0.15;
/** An edge with an unmatched endpoint recedes with its node — otherwise the
 *  dimmed periphery stays wired into the matched core at full strength and
 *  the filter still doesn't read. */
export const UNMATCHED_EDGE_DIM = 0.2;

/** Node size encodes link count and nothing else — matched/unmatched is
 *  carried by colour, not radius. The earlier formula keyed the base
 *  radius off match+icon status and only let degree nudge it ±60 %
 *  *normalised to the busiest node*, so a single mega-hub flattened every
 *  other node to one indistinguishable size and unlinked matched nodes
 *  rendered larger than linked ones. This is an absolute log curve:
 *  `r = MIN + ln(deg+1) * RADIUS_PER_LOG_LINK`, clamped to MAX. Absolute
 *  (not divided by `log(maxDeg+1)`) so a node's size is stable regardless
 *  of what else is in the graph and the low end stays legibly spread. */
const MIN_RADIUS = 4;
const RADIUS_PER_LOG_LINK = 2.4;
const MAX_RADIUS = 22;
/** Below this radius a disc is too small to paint a legible glyph, so the
 *  icon is dropped and the node renders as a plain coloured dot. This is a
 *  *visibility gate on the glyph*, not a floor on the radius — size stays
 *  strictly monotonic in link count (an unlinked node is 4 px whether or
 *  not it would otherwise carry an icon). Matches the long-standing
 *  treatment of tiny unmatched discs: colour alone carries identity. */
const GLYPH_MIN_RADIUS = 7;

export type SceneOptions = {
	/** Reveal cutoff (ms epoch). null = show everything. */
	cutoffAt: number | null;
	/** Which reveal curve maps an element's age (relative to the cutoff)
	 *  to its alpha — see `computeRevealAlpha`. */
	reveal: HistoryReveal;
	/** How wide the soft "Eased" window is around the cutoff, ms. */
	easeWindowMs: number;
	/** "Recent" mode: the trailing span before the cutoff over which an
	 *  element stays fully lit before it fades toward the history floor. */
	recentWindowMs: number;
	/** Show every entity in the graph (true) or only those bound to the
	 *  pattern (false). Colour is by object type either way; this only
	 *  controls whether non-matching entities are present in the scene. */
	showUnmatched: boolean;
	/** Whether matched nodes paint an emoji glyph on the disc. Drives the
	 *  base radius too — icons need 8 px, plain discs are happy at 5 px. */
	showIcons: boolean;
	/** Resolved graph palette + edge colours. Defaults to the fallback set
	 *  so callers without a DOM (tests) work unchanged. */
	theme: GraphTheme;
};

/** Half-width of the fade window around the cutoff. The design spec
 *  (` §Eased`) calls for a 24h
 *  total fade — entities go from invisible → fully visible across the
 *  24h centred on their `created_at`. With `easeWindowMs = 12h` and the
 *  `(delta + easeWindowMs) / (2 * easeWindowMs)` formula in
 *  `computeAlpha`, that's exactly a 24h total window. */
export const EASE_WINDOW_MS = 1000 * 60 * 60 * 12;

/** "Recent" mode default: elements stay fully lit for 7 days after their
 *  `created_at` passes the cutoff, then fade toward `RECENT_FLOOR_ALPHA`
 *  over the *next* `recentWindowMs` — a comet tail that keeps the history
 *  legible (dim, not gone) while the eye stays on fresh activity. */
export const RECENT_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

/** How dim a long-settled element gets in "Recent" mode — visible enough
 *  to keep the graph's shape readable, faint enough that recent edits
 *  pop. Never 0: "Recent" dims history, it doesn't hide it (that's what
 *  the cutoff itself does). */
export const RECENT_FLOOR_ALPHA = 0.15;

export const DEFAULT_SCENE_OPTIONS: SceneOptions = {
	cutoffAt: null,
	reveal: HistoryReveal.Eased,
	easeWindowMs: EASE_WINDOW_MS,
	recentWindowMs: RECENT_WINDOW_MS,
	showUnmatched: true,
	showIcons: true,
	theme: FALLBACK_GRAPH_THEME,
};

export type Scene = {
	matchResult: MatchResult;
	renderNodes: RenderNode[];
	renderEdges: RenderEdge[];
	/** Useful for the scrubber: min/max event timestamps in the visible set. */
	bounds: { min: number; max: number } | null;
};

export type SceneStats = {
	bindings: number;
	visibleNodes: number;
	visibleEdges: number;
};

/** The match-summary numbers: "Visible" counts what the canvas actually
 *  paints (`renderNodes` / `renderEdges`), never the pattern-bound subset.
 *  The old summary reported `matchResult.links.size` — links bound by
 *  pattern *edge constraints* — which is always 0 for the default
 *  no-edges pattern even while every vault link renders (F-157); its node
 *  sum over `nodesBySubject` also double-counted entities matched by more
 *  than one subject. */
export function sceneStats(scene: Scene): SceneStats {
	return {
		bindings: scene.matchResult.matches.length,
		visibleNodes: scene.renderNodes.length,
		visibleEdges: scene.renderEdges.length,
	};
}

export function buildScene(
	pattern: GraphPattern,
	db: InMemoryGraph,
	options: SceneOptions = DEFAULT_SCENE_OPTIONS,
): Scene {
	const theme = options.theme ?? FALLBACK_GRAPH_THEME;
	const matchResult = matchPattern(pattern, db);
	const subjectByEntity = invertNodesBySubject(matchResult);

	const degreeByEntity = computeDegree(db);

	// History reveal is a topology gate, not an opacity ramp: an entity
	// not-yet-created at the cutoff is dropped from the scene so the
	// reconcile pass sees it as "added later", reheats the force engine,
	// and the graph visibly grows as the cutoff sweeps forward.
	const isRevealed = (createdAt: number): boolean =>
		options.cutoffAt === null || createdAt <= options.cutoffAt;

	const renderNodes = (
		options.showUnmatched ? db.entities : db.entities.filter((e) => subjectByEntity.has(e.id))
	)
		.filter((e) => isRevealed(e.createdAt))
		.map<RenderNode>((entity) => {
			// `subjectName` is kept for the hover preview + focus highlight,
			// but colour is now driven by the object's TYPE, not pattern
			// membership — so the graph reads as a stable type legend and an
			// icon-less node still gets a meaningful solid disc colour.
			const subjectName = subjectByEntity.get(entity.id) ?? null;
			const color = colorForType(entity.type, theme);
			const alpha =
				computeAlpha(entity.createdAt, options) * (subjectName === null ? UNMATCHED_NODE_DIM : 1);
			const degree = degreeByEntity.get(entity.id) ?? 0;
			const radius = Math.min(MIN_RADIUS + Math.log(degree + 1) * RADIUS_PER_LOG_LINK, MAX_RADIUS);
			// Show the object's OWN universal icon — fail-open, independent of
			// pattern-subject membership (per-object-icons-everywhere: an
			// unmatched node still renders its own icon; the subject only
			// drives `color` above, never icon visibility). An object with no
			// icon renders as a plain coloured disc — we never fabricate a
			// type-derived glyph it doesn't actually have (product decision:
			// no invented icons in the graph).
			const showIcon = options.showIcons;
			const icon = showIcon ? resolveIcon(entity) : null;
			// Pre-load / legacy-SVG fallback: only the object's OWN emoji.
			// Radius-gated — a tiny disc can't hold a legible glyph.
			const glyph =
				showIcon && radius >= GLYPH_MIN_RADIUS && icon && icon.kind === IconKind.Emoji
					? icon.value
					: "";
			return {
				id: entity.id,
				entity,
				subjectName,
				color,
				alpha,
				radius,
				icon,
				iconSrc: iconKey(icon) ?? "",
				glyph,
			};
		});

	const revealedIds = new Set(renderNodes.map((n) => n.id));
	const renderEdges = db.links
		.filter((l) => l.deletedAt === null)
		.filter((l) => isRevealed(l.createdAt))
		// Edge visibility is endpoint-driven: an edge renders when both of its
		// nodes survive into the scene. With `showUnmatched=false` the unmatched
		// nodes are already gone, so this drops their incident edges and keeps
		// the ones wiring the matched core together. (Gating on
		// `matchResult.links` instead hid EVERY edge under the default
		// node-only pattern — it binds no pattern edges, so that set is empty.)
		// `matchResult.links` still drives the brighter matched-edge colour below.
		.filter((l) => revealedIds.has(l.sourceEntityId) && revealedIds.has(l.destEntityId))
		.map<RenderEdge>((link) => {
			const inPattern = matchResult.links.has(link.id);
			const endpointsMatched =
				subjectByEntity.has(link.sourceEntityId) && subjectByEntity.has(link.destEntityId);
			const alpha =
				computeAlpha(link.createdAt, options) *
				(inPattern ? EDGE_MATCHED_ALPHA : EDGE_BASE_ALPHA) *
				(endpointsMatched ? 1 : UNMATCHED_EDGE_DIM);
			// Matched (active-pattern) edges keep the bright accent so the
			// sub-graph pops; otherwise colour by reason category so an edge's
			// *why* reads at a glance.
			const color = inPattern
				? theme.edge.matched
				: edgeColorForCategory(linkCategory(link.linkType), theme);
			return { id: link.id, link, color, alpha };
		});

	const bounds = computeBounds(db);
	return { matchResult, renderNodes, renderEdges, bounds };
}

/** Count each entity's incident (non-deleted) links. Used for degree-based
 *  node sizing. */
function computeDegree(db: InMemoryGraph): Map<string, number> {
	const out = new Map<string, number>();
	for (const e of db.entities) out.set(e.id, 0);
	for (const l of db.links) {
		if (l.deletedAt !== null) continue;
		out.set(l.sourceEntityId, (out.get(l.sourceEntityId) ?? 0) + 1);
		out.set(l.destEntityId, (out.get(l.destEntityId) ?? 0) + 1);
	}
	return out;
}

function invertNodesBySubject(result: MatchResult): Map<string, string> {
	const out = new Map<string, string>();
	for (const [subjectName, ids] of Object.entries(result.nodesBySubject)) {
		for (const id of ids) {
			if (!out.has(id)) out.set(id, subjectName);
		}
	}
	return out;
}

/** Public colour-by-subject helper for sidebar chrome that needs to paint
 *  matching dots/swatches outside the canvas. Same modulo rule as the
 *  in-scene picker so the sidebar and the nodes can never disagree. */
export function subjectColorsFor(
	subjectNames: ReadonlyArray<string>,
	theme: GraphTheme,
): Record<string, string> {
	const out: Record<string, string> = {};
	const palette = theme.subjectPalette;
	subjectNames.forEach((name, i) => {
		out[name] = palette[i % palette.length] ?? theme.unmatched;
	});
	return out;
}

function computeAlpha(createdAt: number, options: SceneOptions): number {
	return computeRevealAlpha(
		createdAt,
		options.cutoffAt,
		options.reveal,
		options.easeWindowMs,
		options.recentWindowMs,
	);
}

/**
 * Pure age→alpha curve for revealed elements. `cutoffAt === null` means
 * "history off" → everything is fully opaque. Otherwise `delta =
 * cutoffAt − createdAt` (positive = the element already existed by the
 * cutoff):
 *
 *   - **Strict / Eased** — a hard step: `delta >= 0 ? 1 : 0`. Timeline
 *     playback is a topology change in `buildScene` (the unrevealed
 *     elements are dropped from the scene, not faded), so the renderer
 *     paints revealed items fully and the engine reheats as they pop in.
 *     This is the "graph builds" effect; the old
 *     centred-fade Eased curve kept every entity in the scene at alpha 0
 *     and the force engine never saw new topology — playback looked dead.
 *   - **Recent** — not-yet-created → 0; fully lit for the trailing
 *     `recentWindowMs` after it appears; then a linear fade to
 *     `RECENT_FLOOR_ALPHA` over the next `recentWindowMs`, clamped at the
 *     floor thereafter (a comet tail emphasising fresh activity without
 *     hiding the settled graph). This is the one mode where opacity *is*
 *     the point, so it keeps its curve.
 *
 * Always returns a value in `[0, 1]`. `easeWindowMs` is kept in the
 * signature so call sites and the SceneOptions shape don't churn — it's
 * unused by Strict/Eased and irrelevant to Recent.
 */
export function computeRevealAlpha(
	createdAt: number,
	cutoffAt: number | null,
	reveal: HistoryReveal,
	_easeWindowMs: number,
	recentWindowMs: number,
): number {
	if (cutoffAt === null) return 1;
	const delta = cutoffAt - createdAt;

	if (reveal === HistoryReveal.Recent) {
		if (delta < 0) return 0;
		const window = Math.max(1, recentWindowMs);
		if (delta <= window) return 1;
		const fade = (delta - window) / window;
		return Math.max(RECENT_FLOOR_ALPHA, 1 - fade * (1 - RECENT_FLOOR_ALPHA));
	}

	// Strict + Eased: pop in. Future items are filtered out of the scene
	// by `buildScene`, so this is `1` for anything we actually paint; the
	// `delta >= 0 ? 1 : 0` form stays so a direct call (tests, future
	// callers) still gets a sane answer.
	return delta >= 0 ? 1 : 0;
}

/** Validate the loosely-typed `entity.properties.icon` blob into a
 *  universal `Icon`, or null when absent/malformed. The in-memory graph
 *  carries `properties` as `Record<string, unknown>` (it mirrors the
 *  pre-entities-service shape), so every field is checked. */
function resolveIcon(entity: EntityRow): Icon | null {
	const raw = entity.properties.icon;
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as { kind?: unknown; value?: unknown; color?: unknown };
	if (typeof obj.kind !== "string" || !ICON_KINDS.has(obj.kind)) return null;
	if (typeof obj.value !== "string" || !obj.value) return null;
	if (obj.kind === IconKind.Pack) {
		return typeof obj.color === "string" && obj.color
			? { kind: IconKind.Pack, value: obj.value, color: obj.color }
			: { kind: IconKind.Pack, value: obj.value };
	}
	if (obj.kind === IconKind.Image) return { kind: IconKind.Image, value: obj.value };
	return { kind: IconKind.Emoji, value: obj.value };
}

function computeBounds(db: InMemoryGraph): Scene["bounds"] {
	if (db.entities.length === 0 && db.links.length === 0) return null;
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	for (const e of db.entities) {
		if (e.createdAt < min) min = e.createdAt;
		if (e.createdAt > max) max = e.createdAt;
	}
	for (const l of db.links) {
		if (l.createdAt < min) min = l.createdAt;
		if (l.createdAt > max) max = l.createdAt;
	}
	return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
