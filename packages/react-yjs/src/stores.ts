/**
 * Typed `YStore` builders over concrete Yjs targets. Pure (no React) so
 * the snapshot + observer wiring is unit-testable with in-memory docs.
 *
 * Y.Doc and Y.XmlFragment use a monotonic version counter as their
 * snapshot: a structural snapshot would be expensive and never
 * referentially stable, whereas editors (Lexical via `@lexical/yjs`)
 * bind to the live object themselves and only need a *change signal*.
 * Y.Text and Y.Map expose their value directly because consumers read it.
 */

import type * as Y from "yjs";
import { type YStore, createYStore, shallowMapEquals } from "./subscription";

export function yTextStore(text: Y.Text): YStore<string> {
	return createYStore<string>({
		bind: (onChange) => {
			text.observe(onChange);
			return () => text.unobserve(onChange);
		},
		read: () => text.toString(),
	});
}

export function yMapStore<V>(map: Y.Map<V>): YStore<ReadonlyMap<string, V>> {
	return createYStore<ReadonlyMap<string, V>>({
		bind: (onChange) => {
			map.observe(onChange);
			return () => map.unobserve(onChange);
		},
		read: () => new Map(map.entries()),
		equals: shallowMapEquals,
	});
}

export function yMapKeyStore<V>(map: Y.Map<V>, key: string): YStore<V | undefined> {
	return createYStore<V | undefined>({
		bind: (onChange) => {
			map.observe(onChange);
			return () => map.unobserve(onChange);
		},
		read: () => map.get(key),
	});
}

/** A change-signal store: `read()` returns a counter the bind handler
 *  bumps on every change, so identity flips iff the target actually
 *  changed and stays stable otherwise. */
function versionStore(bindRaw: (handler: () => void) => () => void): YStore<number> {
	let version = 0;
	return createYStore<number>({
		bind: (onChange) =>
			bindRaw(() => {
				version += 1;
				onChange();
			}),
		read: () => version,
	});
}

export function yDocStore(doc: Y.Doc): YStore<number> {
	return versionStore((handler) => {
		doc.on("update", handler);
		return () => doc.off("update", handler);
	});
}

export function yXmlFragmentStore(fragment: Y.XmlFragment): YStore<number> {
	return versionStore((handler) => {
		fragment.observeDeep(handler);
		return () => fragment.unobserveDeep(handler);
	});
}

/** Change-signal for an `Y.XmlText` (the universal body root Lexical binds
 *  to). Like `yXmlFragmentStore`, this is a monotonic version counter — a
 *  textual snapshot (`text.toString()`) would allocate the whole document
 *  on every keystroke just to detect a change the editor already observes. */
export function yXmlTextStore(text: Y.XmlText): YStore<number> {
	return versionStore((handler) => {
		text.observeDeep(handler);
		return () => text.unobserveDeep(handler);
	});
}
