/**
 * Type-level surface for the Bookmarks app's single canonical entity
 * type (`brainstorm/Bookmark/v1`) plus the surface-view enum.
 *
 * Stage 9.18.1 ships the surface; subsequent iterations land per
 * `docs/implementation-plan.md §Stage 9.18`:
 *   - 9.18.1.5 preview drop (in-memory bookmarks + four surfaces + the
 *     `<BookmarkCard>` primitive + the BP block)
 *   - 9.18.2 real Files-service-backed library; Notes paste-URL →
 *     `embedded-bookmark` suggestion
 *   - 9.18.3 tag boards (Database-app-style board over `Bookmark.tags`)
 *   - 9.18.4 `bookmark` BP block rendered inline in Notes
 *
 * Separate future development (removed from the release 2026-05-30):
 *   - web clipper (external-browser extension, MV3 + pairing) — a third
 *     feeder onto the same Net-2 extraction core → same `Bookmark/v1`;
 *     design preserved in docs/apps/58 §Web clipper + OQ-RX-7.
 */

export * from "./bookmark";
export * from "./surface";
