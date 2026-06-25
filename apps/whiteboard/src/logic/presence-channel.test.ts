/**
 * Local presence channel (9.17.19): the minimal `AwarenessLike` the engine
 * runs on until the Stage-10 transport binds a real `Awareness`. Pins the
 * structural contract the downstream code depends on: change fan-out on
 * every state write, local/remote separation, null-removes, destroy.
 */

import { describe, expect, it, vi } from "vitest";
import { PRESENCE_FIELD } from "./presence";
import { createLocalAwareness, randomClientId } from "./presence-channel";

describe("createLocalAwareness", () => {
	it("starts empty with a stable clientID", () => {
		const a = createLocalAwareness(42);
		expect(a.clientID).toBe(42);
		expect(a.getLocalState()).toBeNull();
		expect(a.getStates().size).toBe(0);
	});

	it("setLocalStateField merges into the local state and fires change", () => {
		const a = createLocalAwareness(1);
		const onChange = vi.fn();
		a.on("change", onChange);
		a.setLocalStateField(PRESENCE_FIELD, { boardId: "wb1" });
		a.setLocalStateField("other", 7);
		expect(a.getLocalState()).toEqual({ [PRESENCE_FIELD]: { boardId: "wb1" }, other: 7 });
		expect(a.getStates().get(1)).toEqual(a.getLocalState());
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it("setLocalState(null) removes the local entry", () => {
		const a = createLocalAwareness(1);
		a.setLocalState({ x: 1 });
		a.setLocalState(null);
		expect(a.getLocalState()).toBeNull();
		expect(a.getStates().size).toBe(0);
	});

	it("applyRemoteState adds / replaces / removes peers but never the local client", () => {
		const a = createLocalAwareness(1);
		const onChange = vi.fn();
		a.on("change", onChange);
		a.applyRemoteState(2, { hello: true });
		expect(a.getStates().get(2)).toEqual({ hello: true });
		a.applyRemoteState(2, null);
		expect(a.getStates().has(2)).toBe(false);
		a.setLocalState({ mine: 1 });
		a.applyRemoteState(1, { stomped: true });
		expect(a.getLocalState()).toEqual({ mine: 1 });
		expect(onChange).toHaveBeenCalledTimes(3);
	});

	it("off unsubscribes and destroy clears everything", () => {
		const a = createLocalAwareness(1);
		const onChange = vi.fn();
		a.on("change", onChange);
		a.off("change", onChange);
		a.applyRemoteState(2, { x: 1 });
		expect(onChange).not.toHaveBeenCalled();
		a.destroy();
		expect(a.getStates().size).toBe(0);
	});

	it("randomClientId yields 32-bit non-negative ints", () => {
		for (let i = 0; i < 20; i++) {
			const id = randomClientId();
			expect(Number.isInteger(id)).toBe(true);
			expect(id).toBeGreaterThanOrEqual(0);
			expect(id).toBeLessThanOrEqual(0xffffffff);
		}
	});
});
