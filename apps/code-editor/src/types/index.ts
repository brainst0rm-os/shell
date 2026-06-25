/**
 * Type-level surface for the Code-Editor app's single canonical entity
 * type (`brainstorm/CodeFile/v1`) plus the language-key enum and the
 * editor's transient `BufferState` shape.
 *
 * Mirrors the per-app `types/index.ts` re-export convention used by
 * calendar / database / bookmarks / tasks / graph / preview /
 * whiteboard (each app's stable type contract lives here).
 */

export * from "./code-file";
