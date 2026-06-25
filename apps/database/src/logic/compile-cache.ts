/**
 * 1-slot memoization layer for `renderActiveView`'s compile pipeline.
 *
 * The Database app's render loop calls `renderActiveView(state)` on every
 * state change — including selection clicks that don't touch the entity
 * set, the active view, or its filter / sort / group config. Without
 * memoization those clicks re-walk every entity, allocate fresh row
 * arrays, and force `memo(GridRow)` to re-check identity against props
 * that ultimately point to the same values.
 *
 * Three sibling 1-slot caches, each keyed on reference identity of its
 * inputs. The fast path is "all references match" → same object out → the
 * downstream React tree skips work. A view-switch or vault rebuild
 * invalidates the slot the moment one of those references changes; no LRU
 * needed because there's only one active compile at a time.
 */

import type { List } from "../types/list";
import type { ListView } from "../types/list-view";
import { type CompiledView, compileView } from "./compile-view";
import type { InMemoryEntities } from "./in-memory-entities";
import type { EntityRow } from "./in-memory-entities";

// ── compileView (filter / sort / group) ──────────────────────────────────

type CompiledViewSlot = {
	view: ListView;
	entities: ReadonlyArray<EntityRow>;
	labelFor: ((key: string) => string | undefined) | undefined;
	orderFor: ((key: string) => number | undefined) | undefined;
	manualOrder: ReadonlyArray<string> | null;
	result: CompiledView;
};

let compiledViewSlot: CompiledViewSlot | null = null;

export function compileViewCached(
	view: ListView,
	entities: ReadonlyArray<EntityRow>,
	labelFor: ((key: string) => string | undefined) | undefined,
	orderFor?: ((key: string) => number | undefined) | undefined,
): CompiledView {
	const manualOrder = view.manualOrder ?? null;
	if (
		compiledViewSlot !== null &&
		compiledViewSlot.view === view &&
		compiledViewSlot.entities === entities &&
		compiledViewSlot.labelFor === labelFor &&
		compiledViewSlot.orderFor === orderFor &&
		compiledViewSlot.manualOrder === manualOrder
	) {
		return compiledViewSlot.result;
	}
	const result = compileView(view, entities, labelFor, orderFor);
	compiledViewSlot = { view, entities, labelFor, orderFor, manualOrder, result };
	return result;
}

// ── filtered-entities (membership + search) ──────────────────────────────

type FilterFn = (entity: EntityRow) => boolean;

type FilteredEntitiesSlot = {
	list: List;
	db: InMemoryEntities;
	searchQuery: string;
	result: ReadonlyArray<EntityRow>;
};

let filteredEntitiesSlot: FilteredEntitiesSlot | null = null;

export function filterEntitiesCached(
	list: List,
	db: InMemoryEntities,
	searchQuery: string,
	buildPredicate: () => FilterFn,
): ReadonlyArray<EntityRow> {
	if (
		filteredEntitiesSlot !== null &&
		filteredEntitiesSlot.list === list &&
		filteredEntitiesSlot.db === db &&
		filteredEntitiesSlot.searchQuery === searchQuery
	) {
		return filteredEntitiesSlot.result;
	}
	const predicate = buildPredicate();
	const result: EntityRow[] = [];
	for (const entity of db.entities) if (predicate(entity)) result.push(entity);
	filteredEntitiesSlot = { list, db, searchQuery, result };
	return result;
}

// ── group-label resolver ────────────────────────────────────────────────

type LabelResolverSlot = {
	db: InMemoryEntities;
	resolver: (key: string) => string | undefined;
};

let labelResolverSlot: LabelResolverSlot | null = null;

export function groupLabelResolverCached(
	db: InMemoryEntities,
	build: () => (key: string) => string | undefined,
): (key: string) => string | undefined {
	if (labelResolverSlot !== null && labelResolverSlot.db === db) {
		return labelResolverSlot.resolver;
	}
	const resolver = build();
	labelResolverSlot = { db, resolver };
	return resolver;
}

// ── group-order resolver (option order for F-037 lane ordering) ──────────

type OrderResolverSlot = {
	db: InMemoryEntities;
	resolver: (key: string) => number | undefined;
};

let orderResolverSlot: OrderResolverSlot | null = null;

/** A stable per-`db` resolver from a group key to its option rank, so the
 *  memoised `compileViewCached` can hold its reference across renders (a fresh
 *  closure each call would defeat the cache). Mirrors
 *  {@link groupLabelResolverCached}. */
export function groupOrderResolverCached(
	db: InMemoryEntities,
	build: () => (key: string) => number | undefined,
): (key: string) => number | undefined {
	if (orderResolverSlot !== null && orderResolverSlot.db === db) {
		return orderResolverSlot.resolver;
	}
	const resolver = build();
	orderResolverSlot = { db, resolver };
	return resolver;
}

// ── test/escape hatch ───────────────────────────────────────────────────

export function resetCompileCache(): void {
	compiledViewSlot = null;
	filteredEntitiesSlot = null;
	labelResolverSlot = null;
	orderResolverSlot = null;
}

export function compileCacheStats(): {
	compiledViewCached: boolean;
	filteredEntitiesCached: boolean;
	labelResolverCached: boolean;
} {
	return {
		compiledViewCached: compiledViewSlot !== null,
		filteredEntitiesCached: filteredEntitiesSlot !== null,
		labelResolverCached: labelResolverSlot !== null,
	};
}
