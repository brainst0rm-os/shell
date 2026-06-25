// @vitest-environment jsdom
/**
 * `useBlankRecoveryGap` (F-236): the shared blank-render recovery used by the
 * Journal island and the Notes editor mount. A blank-with-content render asks
 * for recovery; the hook flips `gapped` true for one frame so the caller
 * unmounts the editor (releasing its replica) then remounts against a revived
 * fresh doc. Attempts are capped, and a target switch resets the budget.
 */

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBlankRecoveryGap } from "./hooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let originalRaf: typeof globalThis.requestAnimationFrame;
const rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
	rafQueue.length = 0;
	originalRaf = globalThis.requestAnimationFrame;
	// Defer the gap-clear callbacks so a test can assert `gapped` is true
	// BEFORE the frame, then drain to clear it.
	globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
		rafQueue.push(cb);
		return rafQueue.length;
	}) as typeof globalThis.requestAnimationFrame;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	globalThis.requestAnimationFrame = originalRaf;
});

function drainRaf(): void {
	act(() => {
		const pending = rafQueue.splice(0);
		for (const cb of pending) cb(0);
	});
}

type Api = ReturnType<typeof useBlankRecoveryGap>;

function mount(getKey: () => string): { api: () => Api; rerender: () => void } {
	let latest: Api;
	function Probe({ resetKey }: { resetKey: string }) {
		latest = useBlankRecoveryGap(resetKey);
		return null;
	}
	let setKey: (k: string) => void = () => {};
	function Host() {
		const [key, set] = useState(getKey());
		setKey = set;
		return <Probe resetKey={key} />;
	}
	act(() => root.render(<Host />));
	return {
		api: () => latest,
		rerender: () => act(() => setKey(getKey())),
	};
}

describe("useBlankRecoveryGap", () => {
	it("flips gapped for one frame on recover, then clears it", () => {
		const { api } = mount(() => "a");
		expect(api().gapped).toBe(false);

		act(() => api().onRecoverBlank());
		expect(api().gapped).toBe(true); // caller unmounts the editor this frame

		drainRaf();
		expect(api().gapped).toBe(false); // remount next frame
	});

	it("caps recovery attempts (default 2) so an unhydratable doc can't loop", () => {
		const { api } = mount(() => "a");

		// Two recoveries are honoured…
		for (let i = 0; i < 2; i++) {
			act(() => api().onRecoverBlank());
			expect(api().gapped).toBe(true);
			drainRaf();
		}
		// …a third within the same budget is a no-op.
		act(() => api().onRecoverBlank());
		expect(api().gapped).toBe(false);
	});

	it("onRecoverReset refreshes the budget after a clean hydrate", () => {
		const { api } = mount(() => "a");
		for (let i = 0; i < 2; i++) {
			act(() => api().onRecoverBlank());
			drainRaf();
		}
		act(() => api().onRecoverReset());

		act(() => api().onRecoverBlank());
		expect(api().gapped).toBe(true); // budget restored
	});

	it("resets the budget when the target key changes", () => {
		let key = "a";
		const { api, rerender } = mount(() => key);
		for (let i = 0; i < 2; i++) {
			act(() => api().onRecoverBlank());
			drainRaf();
		}
		// Exhausted for "a": another recover is a no-op.
		act(() => api().onRecoverBlank());
		expect(api().gapped).toBe(false);

		key = "b";
		rerender();
		// Fresh target → fresh budget.
		act(() => api().onRecoverBlank());
		expect(api().gapped).toBe(true);
	});
});
