/**
 * Type-level surface for the Journal app.
 *
 * Journal registers NO new entity type — by design it's a pure
 * **composition** over `Note/v1`. A "journal entry" is a Note whose
 * title is the canonical ISO date string for the day (`2026-05-14`)
 * and whose body the user writes into. The shapes below are in-memory
 * derived projections, not persisted entities.
 *
 * `JournalView` (user preferences — first day of week, weekend
 * visibility, default mode) IS persisted via `storage.kv` because the
 * preferences are app-specific and not interesting to other apps.
 */

export * from "./entry";
export * from "./view";
