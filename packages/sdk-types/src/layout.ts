/**
 * `brainstorm/Layout/v1` — layouts as data (docs/shell/27-layouts.md).
 *
 * A Layout describes how an entity is *visually presented* in a given
 * context: which cells appear, how they're grouped, in what mode
 * (stacked / grid / freeform), and the linear reading order screen
 * readers + keyboard navigation fall back to. Layouts cannot change
 * *what* an entity is (schema is owned by 19-properties-and-schemas) —
 * they choose what to render and where. They are scoped with the **same
 * overlay model as PropertySchema** (`Scope` reused verbatim — entity >
 * list > type > user > org, per doc 27 §"Layouts as entities").
 *
 * This module is the dependency-free **contract freeze** (Stage 8.1):
 * the shape + cell-kind enums + the validators (reading-order required
 * for `freeform`; structural well-formedness hooks). The resolver
 * (scope precedence — 8.2) and the render pipeline (8.3) build on this;
 * the B7 `cover` chrome surface and the form-designer (8.10) consume it.
 * Only the shared `enum-guard` leaf is a runtime import (type-only for
 * the sibling contracts), so `index.ts` re-exports without a cycle.
 *
 * **OQ-90** (is the chrome-kind set open or shell-curated?) governs the
 * *chrome rendering pipeline* (8.4), not this contract. `ChromeKind`
 * here is doc 27's explicit canonical starting set; 8.4 decides whether
 * apps may extend it. 8.1 has no blocking OQ.
 */

import { enumGuard } from "./enum-guard";
import type { PropertyPredicate } from "./predicate";
import type { DisplayOptions, Scope } from "./properties";

export const LAYOUT_TYPE_URL = "brainstorm/Layout/v1";

/** Top-level layout mode (doc 27 §"Layout structure"). A `group` cell
 *  may declare its own nested `mode`; the top level is single-mode. */
export enum LayoutMode {
	Stacked = "stacked",
	Grid = "grid",
	Freeform = "freeform",
}

/** The context an entity is rendered in (doc 27 §"Contexts"). Each
 *  `(entity, context)` pair resolves to its own Layout entity. */
export enum LayoutContext {
	Full = "full",
	Card = "card",
	Row = "row",
	Chip = "chip",
	Preview = "preview",
	Whiteboard = "whiteboard",
	Print = "print",
}

/** The six cell kinds (doc 27 §"Layout structure"). */
export enum LayoutCellKind {
	Property = "property",
	Block = "block",
	Chrome = "chrome",
	Group = "group",
	Text = "text",
	Divider = "divider",
}

/** Canonical shell-rendered chrome kinds (doc 27 §"Chrome cells").
 *  Whether apps may register additional kinds is OQ-90 (8.4); this is
 *  the frozen starting set every layout author can rely on. */
export enum ChromeKind {
	ActionBar = "actionBar",
	Breadcrumb = "breadcrumb",
	Meta = "meta",
	WindowControls = "windowControls",
	EntityHeader = "entityHeader",
	Tabs = "tabs",
}

export const LAYOUT_MODES = Object.freeze([
	LayoutMode.Stacked,
	LayoutMode.Grid,
	LayoutMode.Freeform,
]) as readonly LayoutMode[];

export const LAYOUT_CONTEXTS = Object.freeze([
	LayoutContext.Full,
	LayoutContext.Card,
	LayoutContext.Row,
	LayoutContext.Chip,
	LayoutContext.Preview,
	LayoutContext.Whiteboard,
	LayoutContext.Print,
]) as readonly LayoutContext[];

export const LAYOUT_CELL_KINDS = Object.freeze([
	LayoutCellKind.Property,
	LayoutCellKind.Block,
	LayoutCellKind.Chrome,
	LayoutCellKind.Group,
	LayoutCellKind.Text,
	LayoutCellKind.Divider,
]) as readonly LayoutCellKind[];

export const CHROME_KINDS = Object.freeze([
	ChromeKind.ActionBar,
	ChromeKind.Breadcrumb,
	ChromeKind.Meta,
	ChromeKind.WindowControls,
	ChromeKind.EntityHeader,
	ChromeKind.Tabs,
]) as readonly ChromeKind[];

/** `grid`-mode cell placement (doc 27 §"grid"). */
export type GridPlacement = { col: number; row: number; colSpan?: number; rowSpan?: number };

/** `freeform`-mode cell placement, in canvas units (doc 27 §"freeform").
 *  Overlap / z-ordering is OQ-86 (v2) — not modelled here. */
export type FreeformPlacement = {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation?: number;
};

type CellBase = {
	/** Stable across edits; referenced by `readingOrder`. */
	id: string;
	/** Show this cell only when the predicate holds against the entity
	 *  (doc 27's `condition`, e.g. hide an empty phone group). Reuses
	 *  the canonical property predicate language. */
	condition?: PropertyPredicate;
	/** Mode-specific positioning. Only the active mode's field is read;
	 *  stacked uses array order and needs neither. */
	grid?: GridPlacement;
	freeform?: FreeformPlacement;
};

export type PropertyCell = CellBase & {
	kind: LayoutCellKind.Property;
	property: string;
	/** Override the property's default `display` from PropertySchema. */
	display?: DisplayOptions;
};

export type BlockCell = CellBase & {
	kind: LayoutCellKind.Block;
	/** Block id / type the BlockEmbed bridge resolves (doc 15). */
	block: string;
};

export type ChromeCell = CellBase & {
	kind: LayoutCellKind.Chrome;
	chrome: ChromeKind;
	/** Chrome-kind-specific render options (e.g. actionBar alignment /
	 *  button set). Opaque here; the 8.4 registry types them. */
	options?: Record<string, unknown>;
};

export type GroupCell = CellBase & {
	kind: LayoutCellKind.Group;
	cells: LayoutCell[];
	/** User literal label, or an app-registered translation key. */
	label?: string;
	labelKey?: string;
	icon?: string;
	/** A group may compose with its own nested mode (doc 27 §"modes"). */
	mode?: LayoutMode;
};

export type TextCell = CellBase & {
	kind: LayoutCellKind.Text;
	/** Literal text (users) or an app-registered translation key. At
	 *  least one is required (validator enforces). */
	text?: string;
	textKey?: string;
};

export type DividerCell = CellBase & { kind: LayoutCellKind.Divider };

export type LayoutCell = PropertyCell | BlockCell | ChromeCell | GroupCell | TextCell | DividerCell;

/**
 * The Layout entity payload (`properties` of a `brainstorm/Layout/v1`
 * object per the single-object-space model). `readingOrder` is the
 * accessibility fallback; it is **mandatory for `freeform`** and
 * auto-derivable for `stacked` / `grid` (see `effectiveReadingOrder`).
 */
export type LayoutDef = {
	mode: LayoutMode;
	scope: Scope;
	/** The render context this layout applies to, or `null` meaning
	 *  **any context** — the wildcard the resolver treats as matching
	 *  every `(entity, context)` request (doc 27 §Resolution: "context
	 *  == C OR context == null"). A context-specific layout always
	 *  out-ranks an any-context one for the same scope. */
	context: LayoutContext | null;
	cells: LayoutCell[];
	readingOrder?: string[];
};

export const isLayoutMode = enumGuard(LAYOUT_MODES);
export const isLayoutContext = enumGuard(LAYOUT_CONTEXTS);
export const isLayoutCellKind = enumGuard(LAYOUT_CELL_KINDS);
export const isChromeKind = enumGuard(CHROME_KINDS);

/** All cell ids in document (pre-)order, recursing into `group` cells —
 *  the universe `readingOrder` must be a permutation of. */
export function collectCellIds(cells: readonly LayoutCell[]): string[] {
	const ids: string[] = [];
	for (const cell of cells) {
		ids.push(cell.id);
		if (cell.kind === LayoutCellKind.Group) ids.push(...collectCellIds(cell.cells));
	}
	return ids;
}

/**
 * The linear reading order actually used for screen readers / `Tab`
 * traversal (doc 27 §Accessibility): `stacked` → document order;
 * `grid` → row-major (by `row` then `col`, document order as the
 * stable tiebreak / fallback when placement is absent) unless an
 * explicit `readingOrder` overrides; `freeform` → the explicit
 * `readingOrder` (mandatory; document order only as a degenerate
 * fallback so a missing one never throws — `validateLayout` is what
 * rejects it).
 */
export function effectiveReadingOrder(def: LayoutDef): string[] {
	const docOrder = collectCellIds(def.cells);
	if (def.readingOrder && def.readingOrder.length > 0) return [...def.readingOrder];
	if (def.mode === LayoutMode.Grid) {
		const rank = new Map<string, number>(docOrder.map((id, i) => [id, i]));
		const placement = new Map<string, GridPlacement | undefined>();
		const walk = (cells: readonly LayoutCell[]): void => {
			for (const c of cells) {
				placement.set(c.id, c.grid);
				if (c.kind === LayoutCellKind.Group) walk(c.cells);
			}
		};
		walk(def.cells);
		return [...docOrder].sort((a, b) => {
			const pa = placement.get(a);
			const pb = placement.get(b);
			if (pa && pb)
				return pa.row - pb.row || pa.col - pb.col || (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
			if (pa) return -1;
			if (pb) return 1;
			return (rank.get(a) ?? 0) - (rank.get(b) ?? 0);
		});
	}
	return docOrder;
}

/** Stable codes for layout validation failures (enum, not bare
 *  literals, per the no-string-discriminator convention). */
export enum LayoutIssueCode {
	InvalidMode = "invalid-mode",
	InvalidContext = "invalid-context",
	EmptyCellId = "empty-cell-id",
	DuplicateCellId = "duplicate-cell-id",
	UnknownCellKind = "unknown-cell-kind",
	PropertyCellMissingProperty = "property-cell-missing-property",
	BlockCellMissingBlock = "block-cell-missing-block",
	ChromeCellInvalidKind = "chrome-cell-invalid-kind",
	TextCellMissingText = "text-cell-missing-text",
	GroupCellEmpty = "group-cell-empty",
	ReadingOrderRequired = "reading-order-required",
	ReadingOrderUnknownId = "reading-order-unknown-id",
	ReadingOrderMissingId = "reading-order-missing-id",
	ReadingOrderDuplicateId = "reading-order-duplicate-id",
}

export type LayoutIssue = { code: LayoutIssueCode; message: string; cellId?: string };

/**
 * Validate a `LayoutDef`. Returns every issue found (`[]` ⇒ valid) so
 * the future layout editor can surface them all at once. Enforces doc
 * 27's hard rules: unique non-empty cell ids; per-kind structural
 * requirements; and the accessibility contract — a `readingOrder`, when
 * present (and **mandatory for `freeform`**), is exactly a permutation
 * of every cell id (no unknowns, no missing, no duplicates).
 */
export function validateLayout(def: LayoutDef): LayoutIssue[] {
	const issues: LayoutIssue[] = [];
	if (!isLayoutMode(def.mode)) {
		issues.push({
			code: LayoutIssueCode.InvalidMode,
			message: `Unknown layout mode "${String(def.mode)}".`,
		});
	}
	if (def.context !== null && !isLayoutContext(def.context)) {
		issues.push({
			code: LayoutIssueCode.InvalidContext,
			message: `Unknown layout context "${String(def.context)}" (use a LayoutContext or null for any).`,
		});
	}

	const seen = new Set<string>();
	const walk = (cells: readonly LayoutCell[]): void => {
		for (const cell of cells) {
			if (typeof cell.id !== "string" || cell.id.length === 0) {
				issues.push({ code: LayoutIssueCode.EmptyCellId, message: "A cell has an empty id." });
			} else if (seen.has(cell.id)) {
				issues.push({
					code: LayoutIssueCode.DuplicateCellId,
					message: `Duplicate cell id "${cell.id}".`,
					cellId: cell.id,
				});
			} else {
				seen.add(cell.id);
			}

			switch (cell.kind) {
				case LayoutCellKind.Property:
					if (!cell.property) {
						issues.push({
							code: LayoutIssueCode.PropertyCellMissingProperty,
							message: `Property cell "${cell.id}" has no property.`,
							cellId: cell.id,
						});
					}
					break;
				case LayoutCellKind.Block:
					if (!cell.block) {
						issues.push({
							code: LayoutIssueCode.BlockCellMissingBlock,
							message: `Block cell "${cell.id}" has no block.`,
							cellId: cell.id,
						});
					}
					break;
				case LayoutCellKind.Chrome:
					if (!isChromeKind(cell.chrome)) {
						issues.push({
							code: LayoutIssueCode.ChromeCellInvalidKind,
							message: `Chrome cell "${cell.id}" has an unknown chrome kind "${String(cell.chrome)}".`,
							cellId: cell.id,
						});
					}
					break;
				case LayoutCellKind.Text:
					if (!cell.text && !cell.textKey) {
						issues.push({
							code: LayoutIssueCode.TextCellMissingText,
							message: `Text cell "${cell.id}" has neither text nor textKey.`,
							cellId: cell.id,
						});
					}
					break;
				case LayoutCellKind.Group:
					if (cell.cells.length === 0) {
						issues.push({
							code: LayoutIssueCode.GroupCellEmpty,
							message: `Group cell "${cell.id}" has no children.`,
							cellId: cell.id,
						});
					}
					walk(cell.cells);
					break;
				case LayoutCellKind.Divider:
					break;
				default:
					issues.push({
						code: LayoutIssueCode.UnknownCellKind,
						message: `Cell "${(cell as LayoutCell).id}" has an unknown kind "${String(
							(cell as { kind?: unknown }).kind,
						)}".`,
						cellId: (cell as LayoutCell).id,
					});
			}
		}
	};
	walk(def.cells);

	const allIds = collectCellIds(def.cells);
	const ro = def.readingOrder;
	if (!ro || ro.length === 0) {
		if (def.mode === LayoutMode.Freeform) {
			issues.push({
				code: LayoutIssueCode.ReadingOrderRequired,
				message: "freeform layouts require an explicit readingOrder (accessibility fallback).",
			});
		}
	} else {
		const idSet = new Set(allIds);
		const roSeen = new Set<string>();
		for (const id of ro) {
			if (!idSet.has(id)) {
				issues.push({
					code: LayoutIssueCode.ReadingOrderUnknownId,
					message: `readingOrder references unknown cell id "${id}".`,
					cellId: id,
				});
			}
			if (roSeen.has(id)) {
				issues.push({
					code: LayoutIssueCode.ReadingOrderDuplicateId,
					message: `readingOrder lists "${id}" more than once.`,
					cellId: id,
				});
			}
			roSeen.add(id);
		}
		for (const id of allIds) {
			if (!roSeen.has(id)) {
				issues.push({
					code: LayoutIssueCode.ReadingOrderMissingId,
					message: `readingOrder omits cell id "${id}".`,
					cellId: id,
				});
			}
		}
	}

	return issues;
}

export function isValidLayout(def: LayoutDef): boolean {
	return validateLayout(def).length === 0;
}

// ─── App-shipped default layouts (Stage 8.5) ────────────────────────────────

/**
 * One entry of a manifest's `layouts:` array (doc 27 §App-shipped
 * defaults). The app declares the `type` + `context` it ships a default
 * for; `config` is the layout body sans `scope`/`context` (the shell
 * forces `app-default` scope on install, and the entry's own `context`).
 */
export type AppLayoutConfig = Omit<LayoutDef, "scope" | "context">;
export type AppLayoutManifestEntry = {
	type: string;
	context: LayoutContext | null;
	config: AppLayoutConfig;
};

/** Stable codes for app-shipped-layout manifest validation (enum, not
 *  bare literals). */
export enum AppLayoutIssueCode {
	EmptyType = "empty-type",
	/** Doc 27 §App-shipped defaults hard rule: an app cannot ship a
	 *  layout for a type it doesn't introduce. */
	ForeignType = "foreign-type",
	InvalidContext = "invalid-context",
	/** Two entries target the same `(type, context)` — ambiguous which
	 *  app-default wins. */
	DuplicateTypeContext = "duplicate-type-context",
	/** The `config` is not a well-formed layout (carries the underlying
	 *  `LayoutIssue`). */
	InvalidConfig = "invalid-config",
}

export type AppLayoutIssue = {
	code: AppLayoutIssueCode;
	message: string;
	entryIndex: number;
	type?: string;
	/** Present when `code === InvalidConfig` — the failing layout rule. */
	layoutIssue?: LayoutIssue;
};

/**
 * Validate a manifest's `layouts:` array against the set of type-urls
 * the app actually introduces (`appOwnedTypes`). Enforces doc 27
 * §App-shipped defaults: non-empty `type`; the type must be app-owned
 * (an app cannot ship a default for a foreign type — cross-type layouts
 * are user-created); a valid `context` (a `LayoutContext` or `null` for
 * any); the `config` is a well-formed layout (reuses `validateLayout`
 * via a synthetic `app-default`-placeholder scope, so the same rules —
 * including the freeform `readingOrder` mandate — apply, DRY); and no
 * two entries collide on `(type, context)`. Returns every issue
 * (`[]` ⇒ valid) so the installer surfaces them all at once.
 */
export function validateAppLayouts(
	entries: readonly AppLayoutManifestEntry[],
	appOwnedTypes: readonly string[],
): AppLayoutIssue[] {
	const issues: AppLayoutIssue[] = [];
	const owned = new Set(appOwnedTypes);
	const seen = new Set<string>();

	entries.forEach((entry, entryIndex) => {
		const type = entry.type;
		if (typeof type !== "string" || type.length === 0) {
			issues.push({
				code: AppLayoutIssueCode.EmptyType,
				message: "Layout entry has an empty type.",
				entryIndex,
			});
		} else if (!owned.has(type)) {
			issues.push({
				code: AppLayoutIssueCode.ForeignType,
				message: `App ships a layout for "${type}", a type it does not introduce (cross-type layouts are user-created).`,
				entryIndex,
				type,
			});
		}

		if (entry.context !== null && !isLayoutContext(entry.context)) {
			issues.push({
				code: AppLayoutIssueCode.InvalidContext,
				message: `Layout entry for "${String(type)}" has an unknown context "${String(entry.context)}".`,
				entryIndex,
				...(typeof type === "string" ? { type } : {}),
			});
		}

		const key = `${String(type)} ${entry.context ?? "*"}`;
		if (seen.has(key)) {
			issues.push({
				code: AppLayoutIssueCode.DuplicateTypeContext,
				message: `Duplicate app-default layout for (type "${String(type)}", context "${entry.context ?? "any"}").`,
				entryIndex,
				...(typeof type === "string" ? { type } : {}),
			});
		}
		seen.add(key);

		const config = entry.config;
		if (!config || typeof config !== "object") {
			issues.push({
				code: AppLayoutIssueCode.InvalidConfig,
				message: `Layout entry for "${String(type)}" has no config.`,
				entryIndex,
				...(typeof type === "string" ? { type } : {}),
			});
			return;
		}

		const synthetic: LayoutDef = {
			mode: config.mode,
			scope: { kind: "type", target: typeof type === "string" && type ? type : "app-default" },
			context: entry.context,
			cells: config.cells ?? [],
			...(config.readingOrder !== undefined ? { readingOrder: config.readingOrder } : {}),
		};
		for (const layoutIssue of validateLayout(synthetic)) {
			// The synthetic context is the entry's own — a context issue is
			// already reported above; don't double-count it.
			if (layoutIssue.code === LayoutIssueCode.InvalidContext) continue;
			issues.push({
				code: AppLayoutIssueCode.InvalidConfig,
				message: `Layout config for "${String(type)}" is invalid: ${layoutIssue.message}`,
				entryIndex,
				...(typeof type === "string" ? { type } : {}),
				layoutIssue,
			});
		}
	});

	return issues;
}

export function areAppLayoutsValid(
	entries: readonly AppLayoutManifestEntry[],
	appOwnedTypes: readonly string[],
): boolean {
	return validateAppLayouts(entries, appOwnedTypes).length === 0;
}
