/**
 * `<LiveRegion>` + `announce()` — the shell-mounted screen-reader announcement
 * surface from `61-keyboard-accessibility.md`. One polite + one assertive
 * `aria-live` region. `announce(message, options?)` is the single imperative
 * entry point used by every SDK consumer; the dashboard mounts `<LiveRegion>`
 * exactly once at root.
 *
 * Pre-mount calls are queued into a small ring (10 deep, oldest drops) so
 * an early-startup `announce("Loaded")` isn't lost just because the React tree
 * hasn't rendered yet. The flush runs as soon as `<LiveRegion>` mounts.
 *
 * a11y note: changing the live region's text triggers the announcement. To
 * force an announcement even when the same string is announced twice in a row,
 * we clear the region first (RAF tick), then write — empty→same-string IS a
 * change. Assertive announcements interrupt; polite ones wait until the screen
 * reader is idle. NEVER fire assertive for routine state — reserve for error
 * dialogs / blocking interruptions.
 */

import { useEffect, useRef } from "react";
import { KbnAnnouncePoliteness } from "./announce-politeness";

const PRE_MOUNT_RING_DEPTH = 10;

type QueuedMessage = {
	readonly message: string;
	readonly politeness: KbnAnnouncePoliteness;
};

type MountedNodes = {
	polite: HTMLDivElement;
	assertive: HTMLDivElement;
};

let mounted: MountedNodes | null = null;
const preMountQueue: QueuedMessage[] = [];

function flushQueue(nodes: MountedNodes): void {
	while (preMountQueue.length > 0) {
		const next = preMountQueue.shift();
		if (next === undefined) break;
		writeMessage(nodes, next);
	}
}

function writeMessage(nodes: MountedNodes, q: QueuedMessage): void {
	const target = q.politeness === KbnAnnouncePoliteness.Assertive ? nodes.assertive : nodes.polite;
	// Clear-then-write so a repeated identical string still announces — the
	// screen reader only fires on a text change. The microtask delay is small
	// enough not to be perceptible but long enough for the AT to register the
	// transition.
	target.textContent = "";
	queueMicrotask(() => {
		// Re-read mounted state inside the microtask; the region might have
		// unmounted between schedule and execute (StrictMode double-mount,
		// route change).
		if (mounted === null) return;
		const live =
			q.politeness === KbnAnnouncePoliteness.Assertive ? mounted.assertive : mounted.polite;
		live.textContent = q.message;
	});
}

export type AnnounceOptions = {
	politeness?: KbnAnnouncePoliteness;
};

export function announce(message: string, options?: AnnounceOptions): void {
	if (message.length === 0) return;
	const politeness = options?.politeness ?? KbnAnnouncePoliteness.Polite;
	const entry: QueuedMessage = { message, politeness };
	if (mounted === null) {
		preMountQueue.push(entry);
		while (preMountQueue.length > PRE_MOUNT_RING_DEPTH) {
			preMountQueue.shift();
		}
		return;
	}
	writeMessage(mounted, entry);
}

const VISUALLY_HIDDEN: React.CSSProperties = {
	position: "absolute",
	width: "1px",
	height: "1px",
	margin: "-1px",
	padding: 0,
	border: 0,
	clip: "rect(0 0 0 0)",
	clipPath: "inset(50%)",
	overflow: "hidden",
	whiteSpace: "nowrap",
};

/**
 * Mounts the polite + assertive live regions. Mount exactly once per renderer
 * (the dashboard). StrictMode double-mount is safe: the second registration
 * overwrites the first, and the unmount-effect clears the module-scope ref
 * only when it matches its own captured nodes (so the second mount's nodes
 * survive the first unmount).
 */
export function LiveRegion(): React.JSX.Element {
	const politeRef = useRef<HTMLDivElement>(null);
	const assertiveRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const polite = politeRef.current;
		const assertive = assertiveRef.current;
		if (polite === null || assertive === null) return;
		const ownNodes: MountedNodes = { polite, assertive };
		mounted = ownNodes;
		flushQueue(ownNodes);
		return () => {
			if (mounted === ownNodes) mounted = null;
		};
	}, []);

	return (
		<>
			<div
				ref={politeRef}
				role="status"
				aria-live={KbnAnnouncePoliteness.Polite}
				aria-atomic="true"
				style={VISUALLY_HIDDEN}
				data-testid="bs-live-region-polite"
			/>
			<div
				ref={assertiveRef}
				role="alert"
				aria-live={KbnAnnouncePoliteness.Assertive}
				aria-atomic="true"
				style={VISUALLY_HIDDEN}
				data-testid="bs-live-region-assertive"
			/>
		</>
	);
}

/** Test-only: drop the pre-mount queue + clear the mounted ref. NEVER call
 *  from product code — there is exactly one live region per renderer and the
 *  React lifecycle owns mount/unmount. */
export function _resetLiveRegionForTests(): void {
	mounted = null;
	preMountQueue.length = 0;
}
