/**
 * Pure {@link BrowsingSession} reducer — the testable core of the Browser
 * chrome's tab/history model. No DOM, no IPC, no clock: every mutation takes
 * the ids and `now` it needs injected, returns a fresh immutable session, and
 * never reads `Date.now()` / `Math.random()` (so the chrome and the tests
 * drive it identically and restore is deterministic).
 *
 * The chrome maps these state transitions onto {@link WebViewMethod} calls and
 * folds {@link WebViewEvent} metadata back in via {@link applyTabMeta}. The
 * reducer itself knows nothing of the host service — it is the model the
 * chrome renders and persists.
 */

import {
	type BrowserTab,
	type BrowsingSession,
	type BrowsingSessionRecord,
	MAX_RECENTLY_CLOSED,
	NEW_TAB_URL,
	TabLoadState,
	TabSecurityState,
	type TabSnapshot,
} from "../types/browsing-session";

function freshTab(id: string, url: string, isPrivate = false): BrowserTab {
	const blank = url === NEW_TAB_URL;
	return {
		id,
		url,
		title: "",
		faviconUrl: null,
		pinned: false,
		history: blank ? [] : [url],
		historyIndex: blank ? -1 : 0,
		loadState: blank ? TabLoadState.Idle : TabLoadState.Loading,
		securityState: securityForUrl(url),
		blockedTrackerCount: 0,
		private: isPrivate,
	};
}

/** Best-effort scheme-only security guess; the host's authoritative
 *  security-state event overrides it once the page loads. */
function securityForUrl(url: string): TabSecurityState {
	if (url === NEW_TAB_URL || url === "") return TabSecurityState.Local;
	if (url.startsWith("https://")) return TabSecurityState.Secure;
	if (url.startsWith("http://")) return TabSecurityState.Insecure;
	return TabSecurityState.Local;
}

function snapshot(tab: BrowserTab): TabSnapshot {
	return {
		id: tab.id,
		url: tab.url,
		title: tab.title,
		faviconUrl: tab.faviconUrl,
		pinned: tab.pinned,
		history: tab.history,
		historyIndex: tab.historyIndex,
	};
}

/** Replace one tab by id, leaving the rest untouched. No-op (same array
 *  reference) when `id` is absent so callers can compare by identity. */
function mapTab(
	session: BrowsingSession,
	id: string,
	fn: (tab: BrowserTab) => BrowserTab,
): readonly BrowserTab[] {
	let changed = false;
	const tabs = session.tabs.map((tab) => {
		if (tab.id !== id) return tab;
		const next = fn(tab);
		if (next !== tab) changed = true;
		return next;
	});
	return changed ? tabs : session.tabs;
}

export function createSession(params: {
	windowId: string;
	tabId: string;
	now: number;
	url?: string;
}): BrowsingSession {
	const tab = freshTab(params.tabId, params.url ?? NEW_TAB_URL);
	return {
		windowId: params.windowId,
		tabs: [tab],
		activeTabId: tab.id,
		recentlyClosed: [],
		retainHistory: false,
		createdAt: params.now,
		updatedAt: params.now,
	};
}

export function getTab(session: BrowsingSession, tabId: string): BrowserTab | undefined {
	return session.tabs.find((tab) => tab.id === tabId);
}

export function activeTab(session: BrowsingSession): BrowserTab | undefined {
	return session.activeTabId ? getTab(session, session.activeTabId) : undefined;
}

export function openTab(
	session: BrowsingSession,
	params: { tabId: string; now: number; url?: string; activate?: boolean; private?: boolean },
): BrowsingSession {
	const tab = freshTab(params.tabId, params.url ?? NEW_TAB_URL, params.private ?? false);
	const activate = params.activate ?? true;
	return {
		...session,
		tabs: [...session.tabs, tab],
		activeTabId: activate ? tab.id : session.activeTabId,
		updatedAt: params.now,
	};
}

/** Remove a tab, push its snapshot onto the bounded reopen ring, and move the
 *  active marker to a neighbour (the tab to its right, else its left). When
 *  the last tab closes the session is left tab-less with `activeTabId: null` —
 *  the chrome decides whether to open a fresh blank tab or close the window. */
export function closeTab(
	session: BrowsingSession,
	params: { tabId: string; now: number },
): BrowsingSession {
	const index = session.tabs.findIndex((tab) => tab.id === params.tabId);
	if (index === -1) return session;
	const closing = session.tabs[index] as BrowserTab;
	const tabs = session.tabs.filter((tab) => tab.id !== params.tabId);

	let activeTabId = session.activeTabId;
	if (session.activeTabId === params.tabId) {
		const next = tabs[index] ?? tabs[index - 1];
		activeTabId = next ? next.id : null;
	}

	// A private tab leaves no trace — it is never offered for reopen (and never
	// persisted, see toRecord). Only normal tabs join the reopen ring.
	const recentlyClosed = closing.private
		? session.recentlyClosed
		: [...session.recentlyClosed, snapshot(closing)].slice(-MAX_RECENTLY_CLOSED);
	return { ...session, tabs, activeTabId, recentlyClosed, updatedAt: params.now };
}

/** Re-open the most-recently-closed tab (with its history intact) and activate
 *  it. No-op when the ring is empty. */
export function reopenClosedTab(
	session: BrowsingSession,
	params: { now: number },
): BrowsingSession {
	return reopenClosedTabAt(session, { index: session.recentlyClosed.length - 1, now: params.now });
}

/** Re-open the closed-tab snapshot at `index` in the {@link
 *  BrowsingSession.recentlyClosed} ring (0 = oldest, `length - 1` = the most
 *  recent), removing it from the ring and activating the restored tab. An
 *  out-of-range index is a no-op (same reference) so a stale menu selection
 *  can't resurrect a phantom tab. */
export function reopenClosedTabAt(
	session: BrowsingSession,
	params: { index: number; now: number },
): BrowsingSession {
	const restored = session.recentlyClosed[params.index];
	if (!restored) return session;
	const tab: BrowserTab = {
		...restored,
		loadState: TabLoadState.Idle,
		securityState: securityForUrl(restored.url),
		blockedTrackerCount: 0,
		// Reopened tabs are always normal — a private tab was never snapshotted.
		private: false,
	};
	return {
		...session,
		tabs: [...session.tabs, tab],
		activeTabId: tab.id,
		recentlyClosed: session.recentlyClosed.filter((_, i) => i !== params.index),
		updatedAt: params.now,
	};
}

export function activateTab(
	session: BrowsingSession,
	params: { tabId: string; now: number },
): BrowsingSession {
	if (!getTab(session, params.tabId)) return session;
	if (session.activeTabId === params.tabId) return session;
	return { ...session, activeTabId: params.tabId, updatedAt: params.now };
}

/** Navigate a tab to a new URL: truncate any forward history beyond the
 *  cursor (a new branch discards the redo stack — standard browser semantics),
 *  push the URL, and reset the tab into the loading state. */
export function navigateTab(
	session: BrowsingSession,
	params: { tabId: string; url: string; now: number },
): BrowsingSession {
	const tabs = mapTab(session, params.tabId, (tab) => {
		const history = [...tab.history.slice(0, tab.historyIndex + 1), params.url];
		return {
			...tab,
			url: params.url,
			history,
			historyIndex: history.length - 1,
			loadState: TabLoadState.Loading,
			securityState: securityForUrl(params.url),
			blockedTrackerCount: 0,
		};
	});
	if (tabs === session.tabs) return session;
	return { ...session, tabs, updatedAt: params.now };
}

export function canGoBack(tab: BrowserTab): boolean {
	return tab.historyIndex > 0;
}

export function canGoForward(tab: BrowserTab): boolean {
	return tab.historyIndex >= 0 && tab.historyIndex < tab.history.length - 1;
}

export function goBack(
	session: BrowsingSession,
	params: { tabId: string; now: number },
): BrowsingSession {
	const tabs = mapTab(session, params.tabId, (tab) => {
		if (!canGoBack(tab)) return tab;
		const historyIndex = tab.historyIndex - 1;
		return {
			...tab,
			historyIndex,
			url: tab.history[historyIndex] as string,
			loadState: TabLoadState.Loading,
			securityState: securityForUrl(tab.history[historyIndex] as string),
		};
	});
	if (tabs === session.tabs) return session;
	return { ...session, tabs, updatedAt: params.now };
}

export function goForward(
	session: BrowsingSession,
	params: { tabId: string; now: number },
): BrowsingSession {
	const tabs = mapTab(session, params.tabId, (tab) => {
		if (!canGoForward(tab)) return tab;
		const historyIndex = tab.historyIndex + 1;
		return {
			...tab,
			historyIndex,
			url: tab.history[historyIndex] as string,
			loadState: TabLoadState.Loading,
			securityState: securityForUrl(tab.history[historyIndex] as string),
		};
	});
	if (tabs === session.tabs) return session;
	return { ...session, tabs, updatedAt: params.now };
}

export function setPinned(
	session: BrowsingSession,
	params: { tabId: string; pinned: boolean; now: number },
): BrowsingSession {
	const tabs = mapTab(session, params.tabId, (tab) =>
		tab.pinned === params.pinned ? tab : { ...tab, pinned: params.pinned },
	);
	if (tabs === session.tabs) return session;
	return { ...session, tabs, updatedAt: params.now };
}

/** Subset of a tab's runtime/visible fields a {@link WebViewEvent} can carry
 *  back into the model. `url` covers in-page navigation / redirects (the host
 *  is authoritative for the live URL) without pushing a new history entry. */
export type TabMetaPatch = Partial<
	Pick<
		BrowserTab,
		"title" | "faviconUrl" | "url" | "loadState" | "securityState" | "blockedTrackerCount"
	>
>;

/** Fold a metadata event into a tab. Unknown tab → no-op (the view may have
 *  closed before its last event drained). */
export function applyTabMeta(
	session: BrowsingSession,
	params: { tabId: string; patch: TabMetaPatch; now: number },
): BrowsingSession {
	const tabs = mapTab(session, params.tabId, (tab) => ({ ...tab, ...params.patch }));
	if (tabs === session.tabs) return session;
	return { ...session, tabs, updatedAt: params.now };
}

/** Project the live session to its persisted form (drop runtime metadata). */
export function toRecord(session: BrowsingSession): BrowsingSessionRecord {
	// Private tabs are never persisted (incognito leaves no trace). If the
	// active tab was private, the restored session falls back to the first
	// surviving tab — fromRecord/the chrome reconcile a stale active id.
	const persisted = session.tabs.filter((tab) => !tab.private);
	const activeIsPersisted = persisted.some((tab) => tab.id === session.activeTabId);
	return {
		windowId: session.windowId,
		tabs: persisted.map(snapshot),
		activeTabId: activeIsPersisted ? session.activeTabId : (persisted[0]?.id ?? null),
		recentlyClosed: session.recentlyClosed,
		retainHistory: session.retainHistory,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

/** Re-hydrate a persisted record into a live session. Each tab starts
 *  {@link TabLoadState.Idle}; the chrome re-navigates `history[historyIndex]`
 *  and the host's events recompute the live load/security state. */
export function fromRecord(record: BrowsingSessionRecord): BrowsingSession {
	return {
		...record,
		tabs: record.tabs.map((tab) => ({
			...tab,
			loadState: TabLoadState.Idle,
			securityState: securityForUrl(tab.url),
			blockedTrackerCount: 0,
			// Persisted tabs are never private (toRecord excludes them).
			private: false,
		})),
	};
}
