/**
 * Stable-identity wrapper for callbacks that close over render-fresh
 * values.
 *
 * `app.ts` builds the Database app's action callbacks fresh on every
 * `renderActiveView` call (they close over `state`). Passing those raw
 * into a memoized child like `GridRow` makes `memo()` bail out on every
 * render — every visible row re-renders for a single selection click.
 *
 * `useStableCallback(fn)` keeps the latest `fn` in a ref and returns a
 * wrapper whose identity never changes. The wrapper reads the current ref
 * value on each invocation, so behavior tracks the latest closure while
 * identity-equality lets `memo` skip work.
 *
 * Not the same as `useCallback([deps])`: this hook makes no claim about
 * the underlying value being stable — only the wrapper's identity. The
 * trade-off is the wrapper is one indirection slower, which is negligible
 * vs. the cost of a full re-render across a virtualized row window.
 */

import { useCallback, useLayoutEffect, useRef } from "react";

// biome-ignore lint/suspicious/noExplicitAny: callable shape, identity-only wrapper
type AnyFn = (...args: any[]) => any;

// Writing `ref.current = fn` during render is a concurrent-rendering
// antipattern: a render that's torn-up (Suspense, transitions) leaks the
// abandoned closure into the next commit, so a tearing render can leave
// the wrapper pointing at a stale `fn`. `useLayoutEffect` defers the
// assignment to the commit phase, after the render is known to be kept.
export function useStableCallback<T extends AnyFn>(fn: T): T {
	const ref = useRef<T>(fn);
	useLayoutEffect(() => {
		ref.current = fn;
	}, [fn]);
	return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
