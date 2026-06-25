/**
 * Capture lifecycle state (9.18.12). Turning a saved link into offline
 * readable content is an async fetch that can be in flight, succeed, or fail —
 * today that's invisible (a silent `console.warn`). This pure keystone folds
 * the three inputs (has-content · fetch-in-flight · last-attempt-errored) into
 * an explicit state + the set of actions valid in that state, so the detail
 * view + object menu render one consistent affordance without re-deriving the
 * rules each place.
 */

export enum CaptureState {
	/** No content captured and nothing in flight — the page is link-only. */
	Empty = "empty",
	/** A readable fetch is running right now. */
	Capturing = "capturing",
	/** Content is stored (a prior capture succeeded). */
	Captured = "captured",
	/** No content + the last attempt failed — distinct from never-tried so the
	 *  view can offer a retry rather than a first-run "Capture" prompt. */
	Error = "error",
}

/**
 * Derive the capture state. In-flight wins (a refresh of existing content still
 * reads as "Capturing"); otherwise present content is `Captured`; a failed
 * attempt with nothing stored is `Error`; the bare default is `Empty`.
 */
export function deriveCaptureState(
	hasContent: boolean,
	inFlight: boolean,
	errored: boolean,
): CaptureState {
	if (inFlight) return CaptureState.Capturing;
	if (hasContent) return CaptureState.Captured;
	if (errored) return CaptureState.Error;
	return CaptureState.Empty;
}

/** Which per-bookmark content actions are valid in a given state. `capture`
 *  starts a first/retry fetch; `reload` re-fetches existing content; `forget`
 *  drops the stored body. Nothing is offered while a fetch is in flight. */
export type CaptureActions = {
	capture: boolean;
	reload: boolean;
	forget: boolean;
};

export function captureActionsFor(state: CaptureState): CaptureActions {
	const captured = state === CaptureState.Captured;
	const busy = state === CaptureState.Capturing;
	return {
		// First capture (Empty) or retry after a failure (Error).
		capture: !busy && !captured,
		reload: captured,
		forget: captured,
	};
}
