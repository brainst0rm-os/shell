/**
 * Block-frame iframe primitive — the cross-origin opaque-origin sandbox
 * every BP block runs in. This is the 9.5.1 standalone primitive; 9.5.2
 * layers the BP postMessage transport on top of the handle this returns,
 * 9.4.4 mounts it inside `BlockEmbedNode`, 9.5.3 pentests the surface.
 *
 * Security posture (every choice is in
 * {@link ./block-frame-constants.ts | block-frame-constants} so the test
 * suite asserts against the same source of truth):
 *
 *   • `srcdoc` only — never `src`. No network fetch, no URL, no cache.
 *   • Sandbox token set is exactly `allow-scripts`. No `allow-same-origin`
 *     (→ opaque origin), no popups, modals, forms, top-nav, downloads,
 *     pointer-lock, presentation, orientation-lock, storage-access.
 *   • `allow=""` empty — every Permissions-Policy feature denied.
 *   • Inner-document CSP defaults `'none'` and `frame-ancestors 'none'`.
 *   • `referrerpolicy="no-referrer"`, `loading="lazy"`.
 *
 * Lifecycle:
 *
 *   1. `createBlockFrame({ container, ... })` builds the iframe with the
 *      pinned attributes, appends it to `container`, attaches an
 *      IntersectionObserver (visibility → {@link BlockFramePhase}) and a
 *      ResizeObserver (size → relayed via {@link BlockFrameHandle.size}).
 *   2. The host reads phase changes via `onPhase`, current phase via
 *      `getPhase()`, current size via `getSize()`. The size-relay primitive
 *      is wired but the actual postMessage protocol is 9.5.2's surface —
 *      9.5.1 only exposes the *observable*.
 *   3. `destroy()` removes the iframe, disposes both observers, detaches
 *      every listener. Calling twice is a no-op.
 *
 * The primitive is fully standalone: it does not import from React, does
 * not touch the broker, does not call any vault service. A consuming app
 * (apps/notes via 9.4.4) calls `createBlockFrame` from its own DOM tree
 * inside its sandboxed renderer; the security boundary is the iframe's own
 * attributes, not a privileged shell helper.
 */

import {
	BLOCK_FRAME_ALLOW,
	BLOCK_FRAME_DEFAULT_CLASS,
	BLOCK_FRAME_LOADING,
	BLOCK_FRAME_REFERRER_POLICY,
	BLOCK_FRAME_SANDBOX,
	BLOCK_FRAME_SRCDOC,
	type BlockFrameBootstrap,
	BlockFramePhase,
	makeBlockFrameUrl,
} from "./block-frame-constants";

export interface BlockFrameSize {
	readonly width: number;
	readonly height: number;
}

export interface CreateBlockFrameOptions {
	/** Element the iframe is appended to. The iframe sits as the container's
	 *  last child; the host owns the container's layout. */
	readonly container: HTMLElement;
	/** Optional className applied alongside {@link BLOCK_FRAME_DEFAULT_CLASS}.
	 *  Cannot replace the default class — that one is load-bearing for the
	 *  host stylesheet defences. */
	readonly className?: string;
	/** Optional accessible label. Wrapped by the host in `t()` already —
	 *  this is the raw localised string. Falls back to "block" (untranslated
	 *  literal; the SDK has no t() registry of its own and the host is the
	 *  appropriate translator). */
	readonly title?: string;
	/** Phase change callback. Fires for every transition out of the previous
	 *  phase including the initial transition to `Mounted` once the
	 *  IntersectionObserver delivers its first entry. Synchronous. */
	readonly onPhase?: (phase: BlockFramePhase) => void;
	/** Size change callback. Fires for every ResizeObserver entry on the
	 *  container element; ints (rounded). Synchronous. */
	readonly onSize?: (size: BlockFrameSize) => void;
	/** Injection point for the IntersectionObserver constructor — tests in
	 *  jsdom (which has no native IntersectionObserver) supply a fake. */
	readonly IntersectionObserverImpl?: typeof IntersectionObserver;
	/** Injection point for ResizeObserver — same rationale. */
	readonly ResizeObserverImpl?: typeof ResizeObserver;
	/** The BP block id to load. When supplied alongside {@link bootstrap}, the
	 *  iframe loads the providing app's real bundle from its own `bsblock://`
	 *  origin (served by the shell — see `main/blocks/block-frame-protocol.ts`)
	 *  so the block document carries its own CSP instead of inheriting the
	 *  embedder's `script-src 'self'`. Omit (or omit `bootstrap`) to keep the
	 *  inert {@link BLOCK_FRAME_SRCDOC} stub. */
	readonly blockId?: string;
	/** Routing identity (channel id + entity id) the block frame URL carries so
	 *  the inner transport can gate inbound messages. Required for the bundle to
	 *  establish its transport; ignored when {@link blockId} is absent. */
	readonly bootstrap?: BlockFrameBootstrap;
}

export interface BlockFrameHandle {
	/** The iframe element itself. Exposed for the test suite + 9.5.2 to
	 *  attach the BP postMessage transport. Host code must not mutate its
	 *  security-relevant attributes (sandbox, srcdoc, src, allow,
	 *  referrerpolicy, csp) — doing so is a sandbox bypass. */
	readonly iframe: HTMLIFrameElement;
	/** Current phase. */
	getPhase(): BlockFramePhase;
	/** Most recent container size (0/0 until the first ResizeObserver entry
	 *  delivers). */
	getSize(): BlockFrameSize;
	/** Whether destroy() has been called. */
	isDestroyed(): boolean;
	/** Tear down: remove the iframe, disconnect both observers, detach every
	 *  listener. Idempotent; subsequent calls are no-ops. After destroy the
	 *  phase is {@link BlockFramePhase.Unloaded}. */
	destroy(): void;
}

/**
 * Build a sandboxed BP block iframe and append it to `container`. See file
 * doc for the security posture and lifecycle.
 */
export function createBlockFrame(opts: CreateBlockFrameOptions): BlockFrameHandle {
	const { container, className, title, onPhase, onSize } = opts;
	const doc = container.ownerDocument ?? globalThis.document;
	const iframe = doc.createElement("iframe");

	// Real bundle only when BOTH the block id and its routing identity are
	// present; the inner transport can't gate without the bootstrap, so a
	// blockId-without-bootstrap falls back to the inert stub rather than a
	// frame that can never talk. The sandbox/allow/referrer attributes are
	// pinned identically either way — only the document SOURCE differs.
	const useBundle = opts.blockId !== undefined && opts.bootstrap !== undefined;

	iframe.setAttribute("sandbox", BLOCK_FRAME_SANDBOX);
	iframe.setAttribute("allow", BLOCK_FRAME_ALLOW);
	iframe.setAttribute("referrerpolicy", BLOCK_FRAME_REFERRER_POLICY);
	iframe.setAttribute("loading", BLOCK_FRAME_LOADING);
	if (useBundle && opts.blockId && opts.bootstrap) {
		// The BP block bundle loads from its own `bsblock://` origin (shell-
		// served) so its document carries its OWN CSP and escapes the embedder's
		// `script-src 'self'` — which a `srcdoc` would inherit, blocking the
		// bundle's inline script. The sandbox attribute above still forces an
		// opaque origin + no ambient authority; the scheme only decouples the
		// document's CSP from the embedder's. Stub frames (no blockId) keep
		// `srcdoc` + no `src`.
		iframe.removeAttribute("srcdoc");
		// iframe-src-exempt: opaque-origin sandbox; src is the block sandbox scheme, not remote content
		iframe.setAttribute("src", makeBlockFrameUrl(opts.blockId, opts.bootstrap));
	} else {
		iframe.setAttribute("srcdoc", BLOCK_FRAME_SRCDOC);
		iframe.removeAttribute("src");
	}

	iframe.setAttribute("frameborder", "0");
	iframe.setAttribute("scrolling", "no");
	if (title) iframe.setAttribute("title", title);

	const classes = className
		? `${BLOCK_FRAME_DEFAULT_CLASS} ${className}`
		: BLOCK_FRAME_DEFAULT_CLASS;
	iframe.setAttribute("class", classes);

	container.appendChild(iframe);

	let phase = BlockFramePhase.Paused;
	let size: BlockFrameSize = { width: 0, height: 0 };
	let destroyed = false;

	const setPhase = (next: BlockFramePhase): void => {
		if (destroyed && next !== BlockFramePhase.Unloaded) return;
		if (next === phase) return;
		phase = next;
		try {
			onPhase?.(next);
		} catch {
			/* host callbacks are observer-style; a throw must not break
			 * teardown of the security primitive. */
		}
	};

	const IO = opts.IntersectionObserverImpl ?? globalThis.IntersectionObserver;
	const RO = opts.ResizeObserverImpl ?? globalThis.ResizeObserver;

	const intersection = IO
		? new IO((entries) => {
				const last = entries[entries.length - 1];
				if (!last) return;
				setPhase(last.isIntersecting ? BlockFramePhase.Mounted : BlockFramePhase.Paused);
			})
		: null;
	intersection?.observe(iframe);

	const resize = RO
		? new RO((entries) => {
				const last = entries[entries.length - 1];
				if (!last) return;
				const box = last.contentRect;
				size = { width: Math.round(box.width), height: Math.round(box.height) };
				try {
					onSize?.(size);
				} catch {
					/* same rationale as setPhase: a host throw must not strand
					 * observers / iframe. */
				}
			})
		: null;
	resize?.observe(container);

	if (!IO) {
		// No IntersectionObserver in the host environment — STAY Paused.
		// A security primitive must fail closed: an unknown environment is
		// treated as "not visible, do not deliver", forcing the host to
		// either supply a real IntersectionObserver via
		// `IntersectionObserverImpl` (tests / non-DOM hosts) or run in a
		// real browser where IO is always present (production Electron).
		// The prior fail-open default risked an offscreen frame running
		// scripts on hosts where IO was shimmed / missing — flagged by
		// 9.5.1's pentest pass.
	}

	const destroy = (): void => {
		if (destroyed) return;
		destroyed = true;
		try {
			intersection?.disconnect();
		} catch {
			/* observer state corrupted; keep going so the iframe still
			 * detaches. */
		}
		try {
			resize?.disconnect();
		} catch {
			/* same. */
		}
		if (iframe.parentNode) {
			iframe.parentNode.removeChild(iframe);
		}
		setPhase(BlockFramePhase.Unloaded);
	};

	return {
		iframe,
		getPhase: () => phase,
		getSize: () => size,
		isDestroyed: () => destroyed,
		destroy,
	};
}
