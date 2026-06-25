/**
 * `mountTooltipHost` — the app-side delegated tooltip controller, the
 * tooltip twin of `mountMenuHost`. One controller per renderer installs a
 * handful of document-level listeners and renders the animated `.bs-tooltip`
 * chip for ANY element carrying `data-bs-tooltip` — no per-button React
 * wrapper, no per-button wiring, and it works for both React-rendered and
 * imperative-DOM buttons (the SDK header components have both twins).
 *
 * Why delegation rather than the shell's per-element `<Tooltip>` wrapper:
 * the SDK's icon buttons come in React *and* vanilla-DOM forms
 * (`PanelToggleButton` / `createPanelToggleButton`, `NavButtons` /
 * `createNavButtons`, the object-menu ⋯), and a single document listener
 * covers every one of them — plus any app's own raw `<button>` — the moment
 * it opts in with the attribute. The native `title=` (the slow, unstyled OS
 * tooltip these used to rely on) is dropped in favour of this chip; the
 * `aria-label` stays for screen readers.
 *
 * Coverage is automatic for icon buttons: any `<button>` / `role="button"`
 * that renders no visible text (just an icon), carries an `aria-label`, and
 * has NO native `title` gets the chip from that label with NO per-button
 * wiring — so every icon button in every app is covered, including ones that
 * never had a `title`. A button that still uses a native `title` is left to
 * its OS tooltip (it hasn't migrated) so the two never double-stack; an
 * element opts OUT entirely with `data-bs-no-tooltip`.
 *
 * Attributes a trigger may carry:
 *   - `data-bs-tooltip`           — explicit label text (wins over aria-label)
 *   - `data-bs-tooltip-shortcut`  — an optional chord (e.g. "⌘K"), rendered
 *                                    dimmed after the label
 *   - `data-bs-no-tooltip`        — suppress the chip on this element/subtree
 *
 * Install is idempotent + refcounted: `BrainstormMenuProvider` calls it so
 * every app gets tooltips for free, but a second explicit `mountTooltipHost`
 * (or React StrictMode's double-invoke) just bumps the count. The returned
 * disposer drops the count and tears the listeners down at zero.
 */

import "./tooltip.css";

const ATTR = "data-bs-tooltip";
const SHORTCUT_ATTR = "data-bs-tooltip-shortcut";
const OPT_OUT_ATTR = "data-bs-no-tooltip";
const BUTTON_SELECTOR = 'button, [role="button"]';
const HOVER_DELAY_MS = 400;
const EDGE_MARGIN = 8;
const MIN_ROOM = 36;

type Placement = "top" | "bottom";

let refCount = 0;
let teardown: (() => void) | null = null;

let chip: HTMLDivElement | null = null;
let activeTarget: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
// Modality tracking (the focus-visible heuristic): a focus that lands via a
// pointer press must NOT pop a chip — otherwise pressing a button reads as a
// blink (hover-show → pointerdown-hide → focus-reshow on the same gesture).
// Only keyboard-driven focus shows the chip.
let lastInputWasPointer = false;
// The trigger just pressed: its hover chip stays suppressed until the pointer
// leaves it, so a chip can't reappear over the menu/popover the press opened.
let suppressedTarget: HTMLElement | null = null;

/** Resolve the tooltip trigger for an event target, if any. Two ways an
 *  element participates, in priority order:
 *    1. Explicit opt-in — the nearest `[data-bs-tooltip]` ancestor.
 *    2. Implicit — the nearest icon-only `<button>` / `role="button"` that
 *       carries an `aria-label` but no visible text. This is what gives EVERY
 *       icon button a tooltip with zero per-button wiring; `labelOf` then
 *       reads the chip text from the `aria-label`.
 *  Either is suppressed by a `[data-bs-no-tooltip]` ancestor (the escape
 *  hatch for an icon control that deliberately wants no chip). */
function triggerFor(node: EventTarget | null): HTMLElement | null {
	if (!(node instanceof Element)) return null;
	if (node.closest(`[${OPT_OUT_ATTR}]`)) return null;
	// Explicit opt-in is unconditional — a caller that sets `data-bs-tooltip`
	// asked for a chip, so we don't apply the icon-only gate here (today every
	// call site is an icon button; the attribute is the deliberate escape hatch
	// for anything that wants a chip on a non-icon trigger).
	const explicit = node.closest(`[${ATTR}]`);
	if (explicit instanceof HTMLElement) return explicit;
	const button = node.closest(BUTTON_SELECTOR);
	if (
		button instanceof HTMLElement &&
		button.getAttribute("aria-label") &&
		// A button that still carries a native `title` manages its own (OS)
		// tooltip and hasn't opted into the chip — skip it, so the fallback
		// never double-stacks a chip over a native tooltip.
		!button.hasAttribute("title") &&
		isIconOnly(button)
	) {
		return button;
	}
	return null;
}

/** Icon-only = renders no visible text (only an icon / SVG). A button whose
 *  own text is its label doesn't need a chip — it already reads itself. */
function isIconOnly(el: HTMLElement): boolean {
	return (el.textContent ?? "").trim().length === 0;
}

function labelOf(el: HTMLElement): string | null {
	return el.getAttribute(ATTR) ?? el.getAttribute("aria-label");
}

function clearTimer(): void {
	if (showTimer !== null) {
		clearTimeout(showTimer);
		showTimer = null;
	}
}

function hide(): void {
	clearTimer();
	activeTarget = null;
	if (chip) {
		chip.remove();
		chip = null;
	}
}

function placementFor(rect: DOMRect, prefersTop: boolean): Placement {
	const canTop = rect.top - EDGE_MARGIN >= MIN_ROOM;
	const canBottom = window.innerHeight - rect.bottom - EDGE_MARGIN >= MIN_ROOM;
	if (prefersTop) return canTop || !canBottom ? "top" : "bottom";
	return canBottom || !canTop ? "bottom" : "top";
}

function showFor(target: HTMLElement): void {
	const label = labelOf(target);
	if (!label || !target.isConnected) {
		hide();
		return;
	}
	// A fresh element each open re-triggers the entrance keyframe.
	if (chip) chip.remove();
	const rect = target.getBoundingClientRect();
	const placement = placementFor(rect, true);

	const next = document.createElement("div");
	next.className =
		placement === "top" ? "bs-tooltip bs-tooltip--top" : "bs-tooltip bs-tooltip--bottom";
	next.setAttribute("role", "tooltip");
	next.appendChild(document.createTextNode(label));

	const shortcut = target.getAttribute(SHORTCUT_ATTR);
	if (shortcut) {
		const chord = document.createElement("span");
		chord.className = "bs-tooltip__chord";
		chord.textContent = shortcut;
		next.appendChild(chord);
	}

	const center = rect.left + rect.width / 2;
	next.style.left = `${center}px`;
	next.style.top = `${placement === "top" ? rect.top - EDGE_MARGIN : rect.bottom + EDGE_MARGIN}px`;
	document.body.appendChild(next);
	// Clamp horizontally so a trigger near the viewport edge (e.g. the trailing
	// object-menu ⋯) doesn't push the chip off-screen or force it to wrap; the
	// `translate(-50%)` keeps it centred until an edge pulls it back in.
	const half = next.getBoundingClientRect().width / 2;
	const min = EDGE_MARGIN + half;
	const max = window.innerWidth - EDGE_MARGIN - half;
	if (max >= min) next.style.left = `${Math.min(Math.max(center, min), max)}px`;
	chip = next;
	activeTarget = target;
}

function scheduleShow(target: HTMLElement, delay: number): void {
	if (suppressedTarget === target) return;
	if (activeTarget === target && chip) return;
	clearTimer();
	activeTarget = target;
	if (delay <= 0) {
		showFor(target);
		return;
	}
	showTimer = setTimeout(() => {
		showTimer = null;
		if (activeTarget === target) showFor(target);
	}, delay);
}

function install(): () => void {
	const onPointerOver = (event: PointerEvent) => {
		const tip = triggerFor(event.target);
		if (tip) scheduleShow(tip, HOVER_DELAY_MS);
	};
	const onPointerOut = (event: PointerEvent) => {
		const tip = triggerFor(event.target);
		if (!tip) return;
		const to = event.relatedTarget;
		if (to instanceof Node && tip.contains(to)) return;
		// Leaving the pressed trigger lifts its suppression so a later, deliberate
		// hover can show the chip again.
		if (suppressedTarget === tip) suppressedTarget = null;
		if (tip === activeTarget) hide();
	};
	// Pressing a trigger records pointer modality (so the focus it grants doesn't
	// re-pop the chip), dismisses any open chip, and suppresses its hover chip
	// until the pointer leaves — together this kills the press-blink.
	const onPointerDown = (event: PointerEvent) => {
		lastInputWasPointer = true;
		const tip = triggerFor(event.target);
		hide();
		if (tip) suppressedTarget = tip;
	};
	const onFocusIn = (event: FocusEvent) => {
		if (lastInputWasPointer) return;
		const tip = triggerFor(event.target);
		if (tip) scheduleShow(tip, 0);
	};
	const onFocusOut = (event: FocusEvent) => {
		const tip = triggerFor(event.target);
		if (tip && tip === activeTarget) hide();
	};
	// A lingering chip over moved / dismissed content reads as broken.
	const onDismiss = () => hide();
	const onKeyDown = (event: KeyboardEvent) => {
		lastInputWasPointer = false;
		if (event.key === "Escape") hide();
	};

	document.addEventListener("pointerover", onPointerOver, true);
	document.addEventListener("pointerout", onPointerOut, true);
	document.addEventListener("focusin", onFocusIn, true);
	document.addEventListener("focusout", onFocusOut, true);
	document.addEventListener("pointerdown", onPointerDown, true);
	document.addEventListener("keydown", onKeyDown, true);
	window.addEventListener("scroll", onDismiss, true);
	window.addEventListener("resize", onDismiss);

	return () => {
		document.removeEventListener("pointerover", onPointerOver, true);
		document.removeEventListener("pointerout", onPointerOut, true);
		document.removeEventListener("focusin", onFocusIn, true);
		document.removeEventListener("focusout", onFocusOut, true);
		document.removeEventListener("pointerdown", onPointerDown, true);
		document.removeEventListener("keydown", onKeyDown, true);
		window.removeEventListener("scroll", onDismiss, true);
		window.removeEventListener("resize", onDismiss);
		lastInputWasPointer = false;
		suppressedTarget = null;
		hide();
	};
}

export function mountTooltipHost(): () => void {
	if (typeof document === "undefined") return () => {};
	refCount += 1;
	if (refCount === 1) teardown = install();
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		refCount -= 1;
		if (refCount === 0) {
			teardown?.();
			teardown = null;
		}
	};
}
