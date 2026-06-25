import { describe, expect, it, vi } from "vitest";
import { type AwarenessLike, type AwarenessState, awarenessStore } from "./awareness";

/** Minimal structural Awareness — exercises the adapter without pulling
 *  `y-protocols/awareness` into the package. */
class FakeAwareness implements AwarenessLike {
	readonly clientID: number;
	private states = new Map<number, AwarenessState>();
	private handlers = new Set<() => void>();

	constructor(clientID = 1) {
		this.clientID = clientID;
	}
	getLocalState(): AwarenessState | null {
		return this.states.get(this.clientID) ?? null;
	}
	setLocalState(state: AwarenessState | null): void {
		if (state === null) this.states.delete(this.clientID);
		else this.states.set(this.clientID, state);
		this.fire();
	}
	setLocalStateField(field: string, value: unknown): void {
		this.setLocalState({ ...(this.getLocalState() ?? {}), [field]: value });
	}
	getStates(): Map<number, AwarenessState> {
		return this.states;
	}
	/** Inject a remote peer's state (no local mutation API for that). */
	setRemote(id: number, state: AwarenessState): void {
		this.states.set(id, state);
		this.fire();
	}
	on(_event: "change", handler: () => void): void {
		this.handlers.add(handler);
	}
	off(_event: "change", handler: () => void): void {
		this.handlers.delete(handler);
	}
	private fire(): void {
		for (const h of this.handlers) h();
	}
}

const microtask = () => Promise.resolve();

describe("awarenessStore", () => {
	it("snapshots local + remote states keyed by client id", async () => {
		const a = new FakeAwareness(1);
		const store = awarenessStore(a);
		store.subscribe(() => {});

		a.setLocalState({ name: "Ada" });
		a.setRemote(2, { name: "Lin" });
		await microtask();

		const snap = store.getSnapshot();
		expect(snap.clientID).toBe(1);
		expect(snap.local).toEqual({ name: "Ada" });
		expect(snap.states.get(2)).toEqual({ name: "Lin" });
	});

	it("notifies once per microtask on change and is stable when unchanged", async () => {
		const a = new FakeAwareness(1);
		const store = awarenessStore(a);
		const listener = vi.fn();
		store.subscribe(listener);

		a.setLocalStateField("cursor", 3);
		a.setLocalStateField("cursor", 4);
		await microtask();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(store.getSnapshot().local).toEqual({ cursor: 4 });

		const stable = store.getSnapshot();
		await microtask();
		expect(store.getSnapshot()).toBe(stable);
	});

	it("clears local state on null", async () => {
		const a = new FakeAwareness(1);
		const store = awarenessStore(a);
		store.subscribe(() => {});
		a.setLocalState({ name: "X" });
		await microtask();
		a.setLocalState(null);
		await microtask();
		expect(store.getSnapshot().local).toBeNull();
	});
});
