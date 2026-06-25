/**
 * `<DomSlot>` — mount a still-imperative DOM node into a React subtree.
 *
 * The Database app's cell-painting helpers (`paintPropertyValue`,
 * `entityIcon`, `coverBackgroundFor` glue) in `render/cells.ts` return
 * raw `HTMLElement`s today. Porting their internals to React (chip
 * shapes, rating widget, tags, date format) is a follow-up; for now
 * every React view component pipes those builders through `<DomSlot>`.
 *
 * Re-runs `build()` whenever `deps` change so cells re-paint on value
 * updates, exactly like the imperative renderer's per-frame rebuild.
 */

import { type ReactElement, useLayoutEffect, useRef } from "react";

export function DomSlot({
	className,
	build,
	deps,
}: {
	className?: string;
	build: () => Element | null;
	deps: ReadonlyArray<unknown>;
}): ReactElement {
	const ref = useRef<HTMLSpanElement | null>(null);
	const buildRef = useRef(build);
	buildRef.current = build;
	useLayoutEffect(() => {
		const host = ref.current;
		if (!host) return;
		host.replaceChildren();
		const node = buildRef.current();
		if (node) host.appendChild(node);
	}, deps);
	return <span ref={ref} className={className} />;
}

/** Like `<DomSlot>` but `paint` writes into the host `<div>` itself —
 *  no inner wrapper. Use this when wrapping an existing imperative
 *  renderer that expects `(host: HTMLElement) => void` and applies
 *  classes / data attributes to `host`. Each render re-paints; the
 *  imperative renderer's own `replaceChildren()` makes that idempotent. */
export function DomPaint({
	className,
	paint,
	deps,
}: {
	className?: string;
	paint: (host: HTMLElement) => void;
	deps: ReadonlyArray<unknown>;
}): ReactElement {
	const ref = useRef<HTMLDivElement | null>(null);
	const paintRef = useRef(paint);
	paintRef.current = paint;
	useLayoutEffect(() => {
		if (ref.current) paintRef.current(ref.current);
	}, deps);
	return <div ref={ref} className={className} />;
}
