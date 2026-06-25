// @vitest-environment jsdom
/**
 * Pins two contracts of `useStableCallback`:
 *  1. Returned wrapper has stable identity across renders even when the
 *     underlying `fn` is recreated every render — this is what lets a
 *     `memo`'d virtualized row skip work.
 *  2. When invoked post-commit (e.g. from a user event, which is the only
 *     call site in the Database grid), the wrapper sees the LATEST `fn`
 *     captured at the most recent commit — not a stale render closure.
 *
 * Lives next to the hook rather than in a generic React-Yjs harness
 * because the consumer (Database React grid) is the only call site.
 */

import { useEffect } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStableCallback } from "./use-stable-callback";

type Probe = {
	identities: Array<(...args: number[]) => number>;
	postCommit: number[];
};

function renderHook(probe: Probe): {
	rerender: (multiplier: number) => void;
	root: Root;
} {
	const el = document.createElement("div");
	document.body.appendChild(el);
	const root = createRoot(el);

	function Harness({ multiplier }: { multiplier: number }) {
		const wrapper = useStableCallback((x: number) => x * multiplier);
		probe.identities.push(wrapper);
		// Invoke post-commit (mirror of a user event firing after the row's
		// commit). useEffect runs after useLayoutEffect, so the ref is fresh.
		useEffect(() => {
			probe.postCommit.push(wrapper(2));
		});
		return null;
	}

	act(() => {
		root.render(<Harness multiplier={10} />);
	});

	return {
		rerender: (multiplier: number) => {
			act(() => {
				root.render(<Harness multiplier={multiplier} />);
			});
		},
		root,
	};
}

let probe: Probe;

beforeEach(() => {
	probe = { identities: [], postCommit: [] };
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("useStableCallback", () => {
	it("returns a wrapper with stable identity across re-renders", () => {
		const { rerender, root } = renderHook(probe);
		rerender(20);
		rerender(30);
		expect(probe.identities).toHaveLength(3);
		expect(probe.identities[0]).toBe(probe.identities[1]);
		expect(probe.identities[1]).toBe(probe.identities[2]);
		act(() => root.unmount());
	});

	it("invokes the latest underlying fn when called post-commit", () => {
		const { rerender, root } = renderHook(probe);
		// First commit: multiplier=10 → 2 * 10 = 20.
		expect(probe.postCommit[0]).toBe(20);
		rerender(20);
		// Second commit: multiplier=20 → 2 * 20 = 40.
		expect(probe.postCommit[1]).toBe(40);
		rerender(99);
		expect(probe.postCommit[2]).toBe(198);
		act(() => root.unmount());
	});
});
