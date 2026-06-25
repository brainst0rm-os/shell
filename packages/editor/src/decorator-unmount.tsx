/**
 * `<OffscreenGate>` — IntersectionObserver-gated decorator wrapper
 * (docs/editing/52 §Phase 1.3). Heavy decorator children — block
 * embeds, image figures, code-block highlighters — render only while
 * intersecting the viewport (or within the overscan margin). When
 * offscreen the gate renders a height-correct placeholder `<div>` so
 * scroll geometry stays stable; on-screen it mounts the real children.
 *
 * One shared `IntersectionObserver` per editor through `OffscreenGateProvider`
 * — each gate `observe`s the placeholder/host element on mount and
 * `unobserve`s on unmount. Falling back to "always rendered" when the
 * platform lacks `IntersectionObserver` (older test environments, SSR)
 * keeps the gate fail-open: an unsupported environment renders more
 * content than necessary, never less.
 */

import {
	type ReactNode,
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

const DEFAULT_ROOT_MARGIN = "200px";

export type OffscreenObserver = {
	register: (el: Element, onIntersect: (visible: boolean) => void) => () => void;
	dispose: () => void;
};

export type OffscreenGateProviderProps = {
	children: ReactNode;
	/** Optional overscan margin in CSS units; defaults to `"200px"` so a
	 *  block just past the viewport edge mounts before it's needed. */
	rootMargin?: string;
};

const OffscreenContext = createContext<OffscreenObserver | null>(null);

export function createOffscreenObserver(rootMargin = DEFAULT_ROOT_MARGIN): OffscreenObserver {
	const ObserverImpl: typeof IntersectionObserver | undefined =
		typeof IntersectionObserver !== "undefined" ? IntersectionObserver : undefined;

	const listeners = new WeakMap<Element, (visible: boolean) => void>();
	let observer: IntersectionObserver | null = null;
	if (ObserverImpl) {
		observer = new ObserverImpl(
			(entries) => {
				for (const entry of entries) {
					const cb = listeners.get(entry.target);
					if (cb) cb(entry.isIntersecting);
				}
			},
			{ rootMargin, threshold: 0 },
		);
	}

	return {
		register(el, cb) {
			listeners.set(el, cb);
			if (observer) {
				observer.observe(el);
			} else {
				// No platform support — fail open (mount the children).
				cb(true);
			}
			return () => {
				listeners.delete(el);
				if (observer) observer.unobserve(el);
			};
		},
		dispose() {
			observer?.disconnect();
		},
	};
}

export function OffscreenGateProvider(props: OffscreenGateProviderProps): ReactNode {
	const { children, rootMargin } = props;
	const observer = useMemo(() => createOffscreenObserver(rootMargin), [rootMargin]);
	useEffect(() => () => observer.dispose(), [observer]);
	return <OffscreenContext.Provider value={observer}>{children}</OffscreenContext.Provider>;
}

export type OffscreenGateProps = {
	/** Height in CSS pixels reserved while the children are unmounted —
	 *  comes from the height cache (`createHeightCache().get(id)`) or
	 *  the typed estimate when unmeasured. */
	height: number;
	children: ReactNode;
};

export function OffscreenGate(props: OffscreenGateProps): ReactNode {
	const { height, children } = props;
	const observer = useContext(OffscreenContext);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = useState<boolean>(observer === null);

	useEffect(() => {
		const el = hostRef.current;
		if (!el) return;
		if (!observer) {
			setVisible(true);
			return;
		}
		return observer.register(el, setVisible);
	}, [observer]);

	if (!visible) {
		return <div ref={hostRef} aria-hidden style={{ height }} />;
	}
	return <div ref={hostRef}>{children}</div>;
}
