/**
 * Shared motion primitives — keep entrance / collapse animations coherent
 * across the shell renderer, SDK helpers, and every app surface.
 *
 * `MOTION_SPRING_STANDARD` mirrors the spring values the shell's Settings
 * drawer uses (stiffness 360, damping 36). Any new shell-level entrance
 * animation pulls from this constant so the product feels uniform — match
 * the existing language, don't invent a parallel one.
 *
 * `prefersReducedMotion()` reads the OS-level `prefers-reduced-motion`
 * media query and is safe to call from non-DOM contexts (returns `false`).
 * Animations should fail closed: when the user has asked for reduced
 * motion, skip the animation and apply the end state instantly.
 */

export const MOTION_SPRING_STANDARD = {
	stiffness: 360,
	damping: 36,
} as const;

// App-window launch fade (opacity-only; see app-preload entrance CSS). Quick
// so the window settles fast and rapid back-to-back launches don't strobe.
export const MOTION_DURATION_ENTRANCE_MS = 150;
export const MOTION_DURATION_PRESS_MS = 80;
export const MOTION_DURATION_PANEL_COLLAPSE_MS = 200;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return false;
	}
	try {
		return window.matchMedia(REDUCED_MOTION_QUERY).matches;
	} catch {
		return false;
	}
}

export type ReducedMotionListener = (reduced: boolean) => void;

export function onReducedMotionChange(listener: ReducedMotionListener): () => void {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return () => {};
	}
	let mql: MediaQueryList;
	try {
		mql = window.matchMedia(REDUCED_MOTION_QUERY);
	} catch {
		return () => {};
	}
	const handler = (event: MediaQueryListEvent): void => {
		listener(event.matches);
	};
	try {
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	} catch {
		mql.addListener(handler);
		return () => mql.removeListener(handler);
	}
}

/**
 * Tween from `start` to `end` over `durationMs`, calling `step` on every
 * animation frame with the interpolated value. Returns a disposer that
 * cancels the tween in flight — callers must invoke it when starting a
 * new tween or unmounting, else the rAF chain keeps writing after intent.
 *
 * Reduced motion or a non-DOM context skips the tween entirely: `step`
 * fires once with `end` and a no-op disposer is returned. Keep the
 * easing simple — `easeOutCubic` matches the decelerated curve apps see
 * in `--motion-easing-decelerated`.
 */
export type TweenStep = (value: number) => void;

export function tweenNumber(
	start: number,
	end: number,
	durationMs: number,
	step: TweenStep,
): () => void {
	if (
		typeof window === "undefined" ||
		typeof window.requestAnimationFrame !== "function" ||
		prefersReducedMotion() ||
		durationMs <= 0
	) {
		// Synchronous on the short-circuit; rAF path defers the first step.
		// Callers that compose tweens must tolerate either order.
		step(end);
		return () => {};
	}

	let cancelled = false;
	const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
	let rafId = 0;

	const tick = (now: number): void => {
		if (cancelled) return;
		const elapsed = now - t0;
		const t = Math.min(1, elapsed / durationMs);
		const eased = 1 - (1 - t) * (1 - t) * (1 - t);
		step(start + (end - start) * eased);
		if (t < 1) {
			rafId = window.requestAnimationFrame(tick);
		}
	};

	rafId = window.requestAnimationFrame(tick);

	return () => {
		cancelled = true;
		if (rafId && typeof window.cancelAnimationFrame === "function") {
			window.cancelAnimationFrame(rafId);
		}
	};
}
