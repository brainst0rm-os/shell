import { describe, expect, it } from "vitest";
import { NEW_TAB_URL } from "../types/browsing-session";
import { hasRecentlyClosed, recentlyClosedEntries } from "./recently-closed";
import {
	applyTabMeta,
	closeTab,
	createSession,
	navigateTab,
	openTab,
	reopenClosedTabAt,
} from "./session";

const UNTITLED = "New tab";

function withClosed() {
	let s = createSession({ windowId: "w1", tabId: "t1", now: 1 });
	s = navigateTab(s, { tabId: "t1", url: "https://a.test", now: 2 });
	s = applyTabMeta(s, { tabId: "t1", now: 3, patch: { title: "Alpha" } });
	s = openTab(s, { tabId: "t2", url: "https://b.test", now: 4 });
	// t2 keeps no title → label falls back to URL.
	s = openTab(s, { tabId: "t3", now: 5 }); // blank tab → label is the placeholder.
	s = closeTab(s, { tabId: "t1", now: 6 });
	s = closeTab(s, { tabId: "t2", now: 7 });
	s = closeTab(s, { tabId: "t3", now: 8 });
	return s;
}

describe("hasRecentlyClosed", () => {
	it("is false for a fresh session and true after a close", () => {
		let s = createSession({ windowId: "w1", tabId: "t1", now: 1 });
		s = openTab(s, { tabId: "t2", now: 2 });
		expect(hasRecentlyClosed(s)).toBe(false);
		s = closeTab(s, { tabId: "t2", now: 3 });
		expect(hasRecentlyClosed(s)).toBe(true);
	});
});

describe("recentlyClosedEntries", () => {
	it("lists closed tabs most-recent-first with title→url→placeholder labels", () => {
		const entries = recentlyClosedEntries(withClosed(), UNTITLED);
		expect(entries.map((e) => e.label)).toEqual([UNTITLED, "https://b.test", "Alpha"]);
	});

	it("carries the ring index so a selection reopens that exact tab", () => {
		const s = withClosed();
		const entries = recentlyClosedEntries(s, UNTITLED);
		// The second-most-recently-closed tab ("https://b.test", id t2).
		const target = entries[1];
		expect(target?.url).toBe("https://b.test");
		const reopened = reopenClosedTabAt(s, { index: target?.index ?? -1, now: 9 });
		expect(reopened.tabs.some((t) => t.id === "t2")).toBe(true);
		expect(reopened.activeTabId).toBe("t2");
		// The other two closed tabs stay in the ring.
		expect(reopened.recentlyClosed).toHaveLength(2);
	});

	it("is empty for a session with no closed tabs", () => {
		const s = createSession({ windowId: "w1", tabId: "t1", now: 1 });
		expect(recentlyClosedEntries(s, UNTITLED)).toEqual([]);
	});

	it("labels a closed blank tab with the placeholder", () => {
		let s = createSession({ windowId: "w1", tabId: "t1", now: 1 });
		s = openTab(s, { tabId: "blank", url: NEW_TAB_URL, now: 2 });
		s = closeTab(s, { tabId: "blank", now: 3 });
		expect(recentlyClosedEntries(s, UNTITLED)[0]?.label).toBe(UNTITLED);
	});
});

describe("reopenClosedTabAt", () => {
	it("is a no-op (same reference) for an out-of-range index", () => {
		const s = withClosed();
		expect(reopenClosedTabAt(s, { index: 99, now: 9 })).toBe(s);
		expect(reopenClosedTabAt(s, { index: -1, now: 9 })).toBe(s);
	});

	it("removes only the reopened snapshot from the ring", () => {
		const s = withClosed();
		const before = s.recentlyClosed.length;
		const reopened = reopenClosedTabAt(s, { index: 0, now: 9 });
		expect(reopened.recentlyClosed).toHaveLength(before - 1);
		expect(reopened.recentlyClosed.some((snap) => snap.id === "t1")).toBe(false);
	});
});
