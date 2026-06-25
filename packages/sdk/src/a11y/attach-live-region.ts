/**
 * `attachLiveRegion` — the imperative twin of the React `<LiveRegion>` /
 * `announce()` (KBN-1b), for plain-DOM / canvas apps that have no React root to
 * host the shell's live region (graph + whiteboard Pixi canvases). Creates a
 * visually-hidden `aria-live` element under `host` and returns an `announce`
 * that screen readers speak.
 *
 * Same a11y nuance as the React version: changing the region's text is what
 * triggers the announcement, so to force a re-announce when the SAME string is
 * announced twice in a row (e.g. nudging a node the same distance twice) we
 * clear the region first, then write on the next tick — empty→same-string IS a
 * change. The hand-rolled per-app regions this replaces omitted that, silently
 * dropping repeated identical announcements.
 *
 * Self-contained: the sr-only clip is applied inline, so consumers need no
 * per-app CSS.
 */

import { KbnAnnouncePoliteness } from "./announce-politeness";

export type AttachLiveRegionOptions = {
	/** `polite` (default) waits for a pause; `assertive` interrupts. */
	politeness?: KbnAnnouncePoliteness;
	/** Extra class on the region element (styling/testing hook). */
	className?: string;
	/** Schedules the clear→write tick (default `requestAnimationFrame`).
	 *  Injected synchronously in tests. */
	schedule?: (callback: () => void) => void;
};

export type LiveRegionHandle = {
	/** Announce `message` to assistive tech. Re-announces even when identical
	 *  to the previous message. Pass `""` to clear without announcing. */
	announce(message: string): void;
	/** Remove the region element and cancel any pending write. */
	dispose(): void;
};

/** Visually-hidden clip applied inline (the standard sr-only recipe). */
function applySrOnly(el: HTMLElement): void {
	Object.assign(el.style, {
		position: "absolute",
		width: "1px",
		height: "1px",
		margin: "-1px",
		padding: "0",
		border: "0",
		overflow: "hidden",
		clip: "rect(0 0 0 0)",
		clipPath: "inset(50%)",
		whiteSpace: "nowrap",
	} satisfies Partial<CSSStyleDeclaration>);
}

export function attachLiveRegion(
	host: HTMLElement,
	options: AttachLiveRegionOptions = {},
): LiveRegionHandle {
	const politeness = options.politeness ?? KbnAnnouncePoliteness.Polite;
	const schedule = options.schedule ?? ((cb: () => void) => requestAnimationFrame(cb));

	const el = document.createElement("div");
	if (options.className) el.className = options.className;
	el.setAttribute("aria-live", politeness);
	el.setAttribute("aria-atomic", "true");
	applySrOnly(el);
	host.appendChild(el);

	// A monotonic token gates the deferred write so a later announce (or
	// dispose) supersedes an earlier pending one without depending on the
	// scheduler's cancel API.
	let token = 0;
	let disposed = false;

	return {
		announce(message: string): void {
			if (disposed) return;
			const mine = ++token;
			el.textContent = "";
			if (message === "") return;
			schedule(() => {
				if (!disposed && mine === token) el.textContent = message;
			});
		},
		dispose(): void {
			disposed = true;
			token++;
			el.remove();
		},
	};
}
