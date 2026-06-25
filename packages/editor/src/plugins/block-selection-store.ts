/**
 * BlockSelectionStore — a vanilla pub-sub store holding the
 * block-level selection (a set of top-level node keys). One instance
 * per editor; held in a React ref and exposed via context.
 *
 * The store is intentionally NOT React state. Re-rendering 50 sibling
 * blocks on every marquee tick is expensive — instead the plugin
 * applies DOM class toggles via `editor.getElementByKey(key)` and only
 * notifies React consumers that care (gutter, action menu, copy/paste).
 *
 * Snapshot is referentially stable: nothing changed → same object
 * reference → `useSyncExternalStore` skips the re-render.
 *
 * Anchor vs focus: mirrors the inline-selection model. `anchorKey` is
 * where the user started selecting; `focusKey` is the moving "tip" that
 * Shift+Arrow / Shift+Click extends. For a single-key selection both
 * point at the same node.
 */

import type { NodeKey } from "lexical";

export type BlockSelectionSnapshot = Readonly<{
	anchorKey: NodeKey | null;
	focusKey: NodeKey | null;
	selectedKeys: ReadonlySet<NodeKey>;
}>;

const EMPTY: BlockSelectionSnapshot = Object.freeze({
	anchorKey: null,
	focusKey: null,
	selectedKeys: new Set<NodeKey>(),
});

type Listener = () => void;

export class BlockSelectionStore {
	private current: BlockSelectionSnapshot = EMPTY;
	private listeners = new Set<Listener>();

	getSnapshot(): BlockSelectionSnapshot {
		return this.current;
	}

	subscribe(fn: Listener): () => void {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	}

	clear(): void {
		if (this.current === EMPTY) return;
		this.current = EMPTY;
		this.emit();
	}

	setOnly(key: NodeKey): void {
		this.current = freeze({
			anchorKey: key,
			focusKey: key,
			selectedKeys: new Set<NodeKey>([key]),
		});
		this.emit();
	}

	toggle(key: NodeKey): void {
		const cur = this.current.selectedKeys;
		const wasSelected = cur.has(key);
		const next = new Set(cur);
		if (wasSelected) next.delete(key);
		else next.add(key);
		if (next.size === 0) {
			this.clear();
			return;
		}
		let nextAnchor = this.current.anchorKey;
		let nextFocus = this.current.focusKey;
		if (!wasSelected) {
			nextAnchor = key;
			nextFocus = key;
		} else {
			if (nextAnchor === key) {
				const first = next.values().next();
				nextAnchor = first.done ? null : first.value;
			}
			if (nextFocus === key) {
				const first = next.values().next();
				nextFocus = first.done ? null : first.value;
			}
		}
		this.current = freeze({ anchorKey: nextAnchor, focusKey: nextFocus, selectedKeys: next });
		this.emit();
	}

	setRange(keys: readonly NodeKey[], anchorKey: NodeKey, focusKey: NodeKey): void {
		if (keys.length === 0) {
			this.clear();
			return;
		}
		this.current = freeze({ anchorKey, focusKey, selectedKeys: new Set(keys) });
		this.emit();
	}

	has(key: NodeKey): boolean {
		return this.current.selectedKeys.has(key);
	}

	private emit(): void {
		for (const fn of this.listeners) fn();
	}
}

function freeze(snapshot: BlockSelectionSnapshot): BlockSelectionSnapshot {
	return Object.freeze(snapshot);
}
