/**
 * Module holder for the renderer's active `MenuStore`. The React surfaces
 * reach the store through context (`useMenu`); imperative call sites —
 * `openAnchoredMenu`, the database column-adder, the graph export menu —
 * run outside any React tree and need a handle to the same store the
 * mounted `<BrainstormMenuProvider>` renders from.
 *
 * `BrainstormMenuProvider` publishes its store here on mount and clears it
 * on unmount. One renderer (the shell dashboard, or one sandboxed app) is
 * one module instance, so this is a per-renderer singleton — exactly one
 * store, never shared across renderer processes.
 */

import type { MenuStore } from "@react-fancy-menus/core/runtime";

let active: MenuStore | null = null;

export function setActiveMenuStore(store: MenuStore | null): void {
	active = store;
}

/**
 * The mounted store, or null when no `<BrainstormMenuProvider>` is up yet.
 * Imperative openers treat null as "menus unavailable" and fail soft rather
 * than throwing into non-React code paths.
 */
export function getActiveMenuStore(): MenuStore | null {
	return active;
}
