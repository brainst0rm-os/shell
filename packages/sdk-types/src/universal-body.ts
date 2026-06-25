/**
 * Universal rich-text body — `brainstorm/UniversalBody/v1`.
 *
 * Every object has a canonical rich-text container — a `Y.XmlText` named
 * `"root"` in the object's Y.Doc. This is the well-known root that
 * `@lexical/yjs`'s `createBinding` binds to (`doc.get('root', XmlText)`):
 * carrying the universal body via Lexical's own root preserves the lazy
 * invariant and avoids forking `@lexical/yjs`. The 9.3.5.B contract
 * originally named the fragment `"body"` / `Y.XmlFragment`; the
 * reconciliation landed in 9.3.5.N2 once the @lexical/yjs binding shape
 * was confirmed. Migration cost was zero because no production data
 * exists on either name yet.
 *
 * Invariants (per docs/data/21-objects-and-collections.md §Universal
 * rich-text body):
 *  - **Universal** — present on every entity regardless of type or
 *    collection. Not a per-type opt-in property.
 *  - **Lazy** — the root doesn't materialize on disk until first
 *    edited. An unused body is zero storage + zero Y.Doc tail. The
 *    `universal-body.test.ts` lazy-zero-bytes property test pins this
 *    structurally; the helper `getUniversalBody(doc)` materialises the
 *    Yjs-internal handle but adds no encoded state. `@lexical/yjs`'s
 *    bootstrap also does not write any state for an empty document, so
 *    the invariant survives the type change.
 *  - **Not a property** — rich text is intrinsic to every object,
 *    alongside the property bag. The 19 `richText` value type remains
 *    for *additional* rich-text properties beyond the primary body.
 *
 * Changing this constant or its type would invalidate every existing
 * Yjs snapshot and break the `@lexical/yjs` binding — the value is part
 * of the on-disk protocol. Pin it.
 */

export const UNIVERSAL_BODY_FRAGMENT_NAME = "root" as const;

export type UniversalBodyFragmentName = typeof UNIVERSAL_BODY_FRAGMENT_NAME;
