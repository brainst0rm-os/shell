import { describe, expect, it } from "vitest";
import {
	type BrowserTab,
	type BrowsingSession,
	MAX_RECENTLY_CLOSED,
	NEW_TAB_URL,
	TabLoadState,
	TabSecurityState,
} from "../types/browsing-session";
import {
	activateTab,
	activeTab,
	applyTabMeta,
	canGoBack,
	canGoForward,
	closeTab,
	createSession,
	fromRecord,
	getTab,
	goBack,
	goForward,
	navigateTab,
	openTab,
	reopenClosedTab,
	setPinned,
	toRecord,
} from "./session";

function base(): BrowsingSession {
	return createSession({ windowId: "w1", tabId: "t1", now: 1000 });
}

function requireTab(s: BrowsingSession, id: string): BrowserTab {
	const tab = getTab(s, id);
	if (!tab) throw new Error(`tab ${id} missing`);
	return tab;
}

describe("createSession", () => {
	it("starts with one active blank tab and no history", () => {
		const s = base();
		expect(s.tabs).toHaveLength(1);
		expect(s.activeTabId).toBe("t1");
		const tab = activeTab(s);
		expect(tab?.url).toBe(NEW_TAB_URL);
		expect(tab?.history).toEqual([]);
		expect(tab?.historyIndex).toBe(-1);
		expect(tab?.loadState).toBe(TabLoadState.Idle);
		expect(tab?.securityState).toBe(TabSecurityState.Local);
		expect(s.retainHistory).toBe(false);
	});

	it("opens directly on a URL when given one", () => {
		const s = createSession({ windowId: "w1", tabId: "t1", now: 1, url: "https://a.test" });
		const tab = activeTab(s);
		expect(tab?.history).toEqual(["https://a.test"]);
		expect(tab?.historyIndex).toBe(0);
		expect(tab?.loadState).toBe(TabLoadState.Loading);
		expect(tab?.securityState).toBe(TabSecurityState.Secure);
	});
});

describe("openTab", () => {
	it("appends a tab and activates it by default", () => {
		const s = openTab(base(), { tabId: "t2", now: 2000, url: "https://b.test" });
		expect(s.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
		expect(s.activeTabId).toBe("t2");
		expect(s.updatedAt).toBe(2000);
	});

	it("can open in the background without stealing focus", () => {
		const s = openTab(base(), { tabId: "t2", now: 2, activate: false });
		expect(s.activeTabId).toBe("t1");
		expect(getTab(s, "t2")).toBeDefined();
	});

	it("marks a private tab and defaults normal tabs to non-private (Browser-10)", () => {
		const s = openTab(base(), { tabId: "p1", now: 2, url: "https://x.test", private: true });
		expect(getTab(s, "p1")?.private).toBe(true);
		expect(getTab(s, "t1")?.private).toBe(false);
	});
});

describe("private tabs leave no trace (Browser-10)", () => {
	it("toRecord excludes private tabs and re-points a private active tab", () => {
		let s = openTab(base(), { tabId: "p1", now: 2, url: "https://x.test", private: true });
		expect(s.activeTabId).toBe("p1");
		const record = toRecord(s);
		expect(record.tabs.map((t) => t.id)).toEqual(["t1"]);
		// The persisted active id can't be the dropped private tab.
		expect(record.activeTabId).toBe("t1");
		// A normal tab still persists.
		s = openTab(s, { tabId: "t2", now: 3, url: "https://b.test" });
		expect(toRecord(s).tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
	});

	it("closing a private tab never adds it to the reopen ring", () => {
		let s = openTab(base(), { tabId: "p1", now: 2, url: "https://x.test", private: true });
		s = closeTab(s, { tabId: "p1", now: 3 });
		expect(s.recentlyClosed).toEqual([]);
	});
});

describe("navigateTab", () => {
	it("pushes history and truncates the forward branch", () => {
		let s = base();
		s = navigateTab(s, { tabId: "t1", url: "https://a.test", now: 2 });
		s = navigateTab(s, { tabId: "t1", url: "https://b.test", now: 3 });
		s = navigateTab(s, { tabId: "t1", url: "https://c.test", now: 4 });
		s = goBack(s, { tabId: "t1", now: 5 }); // at b
		s = navigateTab(s, { tabId: "t1", url: "https://d.test", now: 6 }); // branch off b
		const tab = getTab(s, "t1");
		expect(tab?.history).toEqual(["https://a.test", "https://b.test", "https://d.test"]);
		expect(tab?.historyIndex).toBe(2);
		expect(tab?.url).toBe("https://d.test");
		expect(canGoForward(requireTab(s, "t1"))).toBe(false);
	});

	it("ignores navigation on an unknown tab (same reference)", () => {
		const s = base();
		expect(navigateTab(s, { tabId: "ghost", url: "https://x.test", now: 9 })).toBe(s);
	});
});

describe("back / forward", () => {
	function withHistory(): BrowsingSession {
		let s = base();
		s = navigateTab(s, { tabId: "t1", url: "https://a.test", now: 2 });
		s = navigateTab(s, { tabId: "t1", url: "https://b.test", now: 3 });
		return s;
	}

	it("moves the cursor and the URL", () => {
		let s = withHistory();
		expect(canGoBack(requireTab(s, "t1"))).toBe(true);
		s = goBack(s, { tabId: "t1", now: 4 });
		expect(getTab(s, "t1")?.url).toBe("https://a.test");
		expect(canGoForward(requireTab(s, "t1"))).toBe(true);
		s = goForward(s, { tabId: "t1", now: 5 });
		expect(getTab(s, "t1")?.url).toBe("https://b.test");
	});

	it("clamps at both ends (no-op, same reference)", () => {
		const s = withHistory();
		const forwardCapped = goForward(s, { tabId: "t1", now: 6 });
		expect(forwardCapped).toBe(s);
		let back = goBack(s, { tabId: "t1", now: 7 });
		back = goBack(back, { tabId: "t1", now: 8 }); // already at index 0
		expect(getTab(back, "t1")?.historyIndex).toBe(0);
		expect(goBack(back, { tabId: "t1", now: 9 })).toBe(back);
	});

	it("a blank never-navigated tab can neither go back nor forward", () => {
		const tab = requireTab(base(), "t1");
		expect(canGoBack(tab)).toBe(false);
		expect(canGoForward(tab)).toBe(false);
	});
});

describe("closeTab", () => {
	it("activates the right neighbour, then the left when at the end", () => {
		let s = base();
		s = openTab(s, { tabId: "t2", now: 2 });
		s = openTab(s, { tabId: "t3", now: 3 });
		s = activateTab(s, { tabId: "t2", now: 4 });
		s = closeTab(s, { tabId: "t2", now: 5 });
		expect(s.activeTabId).toBe("t3"); // right neighbour took the slot
		s = closeTab(s, { tabId: "t3", now: 6 });
		expect(s.activeTabId).toBe("t1"); // fell back to the left
	});

	it("leaves a tab-less session with null active when the last tab closes", () => {
		const s = closeTab(base(), { tabId: "t1", now: 2 });
		expect(s.tabs).toHaveLength(0);
		expect(s.activeTabId).toBeNull();
	});

	it("closing a background tab keeps the active marker", () => {
		let s = openTab(base(), { tabId: "t2", now: 2 }); // t2 active
		s = closeTab(s, { tabId: "t1", now: 3 });
		expect(s.activeTabId).toBe("t2");
	});

	it("ignores an unknown tab (same reference)", () => {
		const s = base();
		expect(closeTab(s, { tabId: "ghost", now: 2 })).toBe(s);
	});
});

describe("reopenClosedTab", () => {
	it("restores the most-recently-closed tab with its history and activates it", () => {
		let s = base();
		s = navigateTab(s, { tabId: "t1", url: "https://a.test", now: 2 });
		s = navigateTab(s, { tabId: "t1", url: "https://b.test", now: 3 });
		s = openTab(s, { tabId: "t2", now: 4 });
		s = closeTab(s, { tabId: "t1", now: 5 });
		expect(getTab(s, "t1")).toBeUndefined();
		s = reopenClosedTab(s, { now: 6 });
		const restored = getTab(s, "t1");
		expect(restored?.history).toEqual(["https://a.test", "https://b.test"]);
		expect(restored?.loadState).toBe(TabLoadState.Idle);
		expect(s.activeTabId).toBe("t1");
		expect(s.recentlyClosed).toHaveLength(0);
	});

	it("is a no-op on an empty ring (same reference)", () => {
		const s = base();
		expect(reopenClosedTab(s, { now: 2 })).toBe(s);
	});

	it("bounds the reopen ring at MAX_RECENTLY_CLOSED", () => {
		let s = base();
		for (let i = 0; i < MAX_RECENTLY_CLOSED + 5; i++) {
			s = openTab(s, { tabId: `x${i}`, now: 100 + i });
			s = closeTab(s, { tabId: `x${i}`, now: 200 + i });
		}
		expect(s.recentlyClosed).toHaveLength(MAX_RECENTLY_CLOSED);
		// Oldest dropped; newest retained.
		expect(s.recentlyClosed[s.recentlyClosed.length - 1]?.id).toBe(`x${MAX_RECENTLY_CLOSED + 4}`);
	});
});

describe("activateTab", () => {
	it("switches the active marker", () => {
		let s = openTab(base(), { tabId: "t2", now: 2, activate: false });
		s = activateTab(s, { tabId: "t2", now: 3 });
		expect(s.activeTabId).toBe("t2");
	});

	it("is a no-op for the already-active or an unknown tab", () => {
		const s = base();
		expect(activateTab(s, { tabId: "t1", now: 2 })).toBe(s);
		expect(activateTab(s, { tabId: "ghost", now: 2 })).toBe(s);
	});
});

describe("setPinned", () => {
	it("toggles the pin flag and short-circuits when unchanged", () => {
		let s = base();
		s = setPinned(s, { tabId: "t1", pinned: true, now: 2 });
		expect(getTab(s, "t1")?.pinned).toBe(true);
		expect(setPinned(s, { tabId: "t1", pinned: true, now: 3 })).toBe(s);
	});
});

describe("applyTabMeta", () => {
	it("folds host metadata into the tab", () => {
		let s = base();
		s = applyTabMeta(s, {
			tabId: "t1",
			patch: {
				title: "Example",
				faviconUrl: "brainstorm://asset/fav",
				loadState: TabLoadState.Loaded,
				securityState: TabSecurityState.Secure,
				blockedTrackerCount: 3,
			},
			now: 2,
		});
		const tab = getTab(s, "t1");
		expect(tab?.title).toBe("Example");
		expect(tab?.faviconUrl).toBe("brainstorm://asset/fav");
		expect(tab?.loadState).toBe(TabLoadState.Loaded);
		expect(tab?.blockedTrackerCount).toBe(3);
	});

	it("ignores metadata for an unknown tab (same reference)", () => {
		const s = base();
		expect(applyTabMeta(s, { tabId: "ghost", patch: { title: "x" }, now: 2 })).toBe(s);
	});
});

describe("persistence round-trip", () => {
	it("toRecord drops runtime metadata; fromRecord re-hydrates as Idle", () => {
		let s = base();
		s = navigateTab(s, { tabId: "t1", url: "https://a.test", now: 2 });
		s = applyTabMeta(s, {
			tabId: "t1",
			patch: { loadState: TabLoadState.Loaded, blockedTrackerCount: 9 },
			now: 3,
		});
		s = openTab(s, { tabId: "t2", now: 4, url: "http://b.test" });

		const record = toRecord(s);
		expect(record.tabs[0]).not.toHaveProperty("loadState");
		expect(record.tabs[0]?.history).toEqual(["https://a.test"]);
		expect(record.activeTabId).toBe("t2");

		const live = fromRecord(record);
		expect(live.tabs[0]?.loadState).toBe(TabLoadState.Idle);
		expect(live.tabs[0]?.securityState).toBe(TabSecurityState.Secure);
		expect(live.tabs[1]?.securityState).toBe(TabSecurityState.Insecure);
		expect(live.tabs[0]?.blockedTrackerCount).toBe(0);
		expect(live.activeTabId).toBe("t2");
	});
});
