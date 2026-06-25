// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type NavStorage,
	createNavHistory,
	defaultNavEquals,
	navBack,
	navCanBack,
	navCanForward,
	navForward,
	navInit,
	navReplace,
	navTo,
} from "./nav-history";

type Loc = { id: string };
const L = (id: string): Loc => ({ id });

describe("nav-history pure reducers", () => {
	it("initialises with the given location and empty stacks", () => {
		const s = navInit(L("root"));
		expect(s.current).toEqual(L("root"));
		expect(navCanBack(s)).toBe(false);
		expect(navCanForward(s)).toBe(false);
	});

	it("navTo pushes the previous current onto back and clears forward", () => {
		let s = navInit(L("root"));
		s = navTo(s, L("a"));
		s = navTo(s, L("b"));
		expect(s.current).toEqual(L("b"));
		expect(s.back).toEqual([L("root"), L("a")]);
		expect(s.forward).toEqual([]);
	});

	it("navTo to a structurally equal location is a no-op (default equals)", () => {
		const s = navInit(L("root"));
		expect(navTo(s, { id: "root" })).toBe(s);
	});

	it("honours a custom equals", () => {
		const eq = (a: Loc, b: Loc) => a.id[0] === b.id[0];
		const s = navInit(L("apple"));
		expect(navTo(s, L("avocado"), eq)).toBe(s);
		expect(navTo(s, L("banana"), eq).current).toEqual(L("banana"));
	});

	it("back pops current onto forward; forward reverses it", () => {
		let s = navInit(L("root"));
		s = navTo(s, L("a"));
		s = navTo(s, L("b"));
		s = navBack(s);
		expect(s.current).toEqual(L("a"));
		expect(s.forward).toEqual([L("b")]);
		s = navForward(s);
		expect(s.current).toEqual(L("b"));
		expect(navCanForward(s)).toBe(false);
	});

	it("back / forward at the ends are no-ops (same reference)", () => {
		const s = navInit(L("root"));
		expect(navBack(s)).toBe(s);
		expect(navForward(s)).toBe(s);
	});

	it("navReplace swaps current without touching either stack", () => {
		let s = navInit(L("root"));
		s = navTo(s, L("a"));
		const r = navReplace(s, L("a2"));
		expect(r.current).toEqual(L("a2"));
		expect(r.back).toBe(s.back);
		expect(r.forward).toBe(s.forward);
		expect(navReplace(r, { id: "a2" })).toBe(r);
	});

	it("caps the back stack at max, dropping the oldest", () => {
		let s = navInit(L("0"));
		for (let i = 1; i <= 10; i++) s = navTo(s, L(String(i)), defaultNavEquals, 3);
		expect(s.back.map((l) => l.id)).toEqual(["7", "8", "9"]);
		expect(s.current).toEqual(L("10"));
	});

	it("8 deep + 8 back returns to root with a full forward stack", () => {
		let s = navInit(L("0"));
		for (let i = 1; i <= 8; i++) s = navTo(s, L(String(i)));
		for (let i = 0; i < 8; i++) s = navBack(s);
		expect(s.current).toEqual(L("0"));
		expect(s.forward.map((l) => l.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
	});
});

describe("createNavHistory controller", () => {
	it("push/back/forward return the location to apply and notify", () => {
		const nav = createNavHistory<Loc>({ initial: L("home") });
		const seen: string[] = [];
		nav.subscribe(() => seen.push(nav.current().id));

		nav.push(L("a"));
		nav.push(L("b"));
		expect(nav.canGoBack()).toBe(true);
		expect(nav.back()).toEqual(L("a"));
		expect(nav.back()).toEqual(L("home"));
		expect(nav.back()).toBeNull();
		expect(nav.forward()).toEqual(L("a"));
		expect(seen).toEqual(["a", "b", "a", "home", "a"]);
	});

	it("push clears the forward stack", () => {
		const nav = createNavHistory<Loc>({ initial: L("home") });
		nav.push(L("a"));
		nav.back();
		expect(nav.canGoForward()).toBe(true);
		nav.push(L("c"));
		expect(nav.canGoForward()).toBe(false);
	});

	it("reset discards all history and starts over", () => {
		const nav = createNavHistory<Loc>({ initial: L("home") });
		nav.push(L("a"));
		nav.push(L("b"));
		nav.back();
		const fn = vi.fn();
		nav.subscribe(fn);
		nav.reset(L("fresh"));
		expect(nav.current()).toEqual(L("fresh"));
		expect(nav.canGoBack()).toBe(false);
		expect(nav.canGoForward()).toBe(false);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("a no-op push does not notify subscribers", () => {
		const nav = createNavHistory<Loc>({ initial: L("home") });
		const fn = vi.fn();
		nav.subscribe(fn);
		nav.push(L("home"));
		expect(fn).not.toHaveBeenCalled();
	});

	it("unsubscribe stops notifications", () => {
		const nav = createNavHistory<Loc>({ initial: L("home") });
		const fn = vi.fn();
		const off = nav.subscribe(fn);
		nav.push(L("a"));
		off();
		nav.push(L("b"));
		expect(fn).toHaveBeenCalledTimes(1);
	});

	describe("persistence", () => {
		let store: Map<string, string>;
		let storage: NavStorage;
		beforeEach(() => {
			store = new Map();
			storage = {
				getItem: (k) => store.get(k) ?? null,
				setItem: (k, v) => void store.set(k, v),
			};
		});

		it("persists every commit and restores the full stack", () => {
			const a = createNavHistory<Loc>({
				initial: L("home"),
				persist: { key: "k", storage },
			});
			a.push(L("a"));
			a.push(L("b"));
			a.back();

			const b = createNavHistory<Loc>({
				initial: L("ignored"),
				persist: { key: "k", storage },
			});
			expect(b.current()).toEqual(L("a"));
			expect(b.canGoBack()).toBe(true);
			expect(b.canGoForward()).toBe(true);
		});

		it("collapses to a fresh init when the restored current is invalid", () => {
			store.set("k", JSON.stringify({ current: L("gone"), back: [], forward: [] }));
			const nav = createNavHistory<Loc>({
				initial: L("home"),
				persist: { key: "k", storage, isValid: (l) => l.id !== "gone" },
			});
			expect(nav.current()).toEqual(L("home"));
		});

		it("survives malformed persisted JSON", () => {
			store.set("k", "{not json");
			const nav = createNavHistory<Loc>({
				initial: L("home"),
				persist: { key: "k", storage },
			});
			expect(nav.current()).toEqual(L("home"));
		});

		it("never throws when storage setItem throws (quota)", () => {
			const throwing: NavStorage = {
				getItem: () => null,
				setItem: () => {
					throw new Error("quota");
				},
			};
			const nav = createNavHistory<Loc>({
				initial: L("home"),
				persist: { key: "k", storage: throwing },
			});
			expect(() => nav.push(L("a"))).not.toThrow();
		});
	});
});

describe("createNavButtons DOM twin", () => {
	let cleanup: Array<() => void>;
	beforeEach(() => {
		cleanup = [];
	});
	afterEach(() => {
		for (const c of cleanup) c();
	});

	it("renders a disabled-by-default group that reacts to history", async () => {
		const { createNavButtons } = await import("./create-nav-buttons");
		const nav = createNavHistory<Loc>({ initial: L("home") });
		const applied: Loc[] = [];
		const handle = createNavButtons<Loc>({
			history: nav,
			onNavigate: (l) => applied.push(l),
			shortcuts: false,
		});
		cleanup.push(handle.destroy);
		document.body.appendChild(handle.element);

		const back = handle.element.querySelector<HTMLButtonElement>('[data-testid="nav-back"]');
		const fwd = handle.element.querySelector<HTMLButtonElement>('[data-testid="nav-forward"]');
		expect(back?.disabled).toBe(true);
		expect(fwd?.disabled).toBe(true);

		nav.push(L("a"));
		expect(back?.disabled).toBe(false);

		back?.click();
		expect(applied).toEqual([L("home")]);
		expect(fwd?.disabled).toBe(false);
	});

	it("destroy unsubscribes — later history changes don't touch the DOM", async () => {
		const { createNavButtons } = await import("./create-nav-buttons");
		const nav = createNavHistory<Loc>({ initial: L("home") });
		const handle = createNavButtons<Loc>({
			history: nav,
			onNavigate: () => {},
			shortcuts: false,
		});
		const back = handle.element.querySelector<HTMLButtonElement>('[data-testid="nav-back"]');
		handle.destroy();
		nav.push(L("a"));
		expect(back?.disabled).toBe(true);
	});
});
