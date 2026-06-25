/**
 * @vitest-environment jsdom
 *
 * `<WhatsNewPopover>` — Feedback-3 v2 auto-popup.
 *
 * Pins the decide-once gating, the dismiss/view side effects, the
 * silent fallback when the IPC fetch rejects, and the Prev/Next
 * pagination. Gating-math fences live in `./changelog-gating.test.ts`
 * — these tests only exercise the rendered component's behaviour.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Changelog, ChangelogBlock } from "../../preload";
import { WhatsNewPopover } from "./whats-new-popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const DEFAULT_BODY: readonly ChangelogBlock[] = [{ kind: "p", text: [{ text: "body" }] }];

function changelog(versions: string[], body: readonly ChangelogBlock[] = DEFAULT_BODY): Changelog {
	return {
		format: "brainstorm/changelog/v2",
		releases: versions.map((version) => ({
			version,
			date: "2026-05-23",
			icon: "🎉",
			title: `Release ${version}`,
			body,
		})),
	};
}

beforeEach(() => {
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

async function flushPromises() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

function queryPanel(): HTMLElement | null {
	return container.ownerDocument.querySelector<HTMLElement>('[data-testid="whats-new-popover"]');
}

function buttonByText(text: string): HTMLButtonElement | undefined {
	return Array.from(container.ownerDocument.querySelectorAll("button")).find(
		(b) => b.textContent === text,
	);
}

describe("<WhatsNewPopover>", () => {
	it("stays hidden until the snapshot is ready", async () => {
		const fetchChangelog = vi.fn().mockResolvedValue(changelog(["0.2.0", "0.1.0"]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={false}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		expect(queryPanel()).toBeNull();
	});

	it("surfaces the newest release when snapshot is ready and nothing has been seen", async () => {
		const fetchChangelog = vi.fn().mockResolvedValue(changelog(["0.2.0", "0.1.0"]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		const panel = queryPanel();
		expect(panel).not.toBeNull();
		expect(panel?.textContent).toContain("0.2.0");
		expect(panel?.textContent).toContain("Release 0.2.0");
	});

	it("stays hidden when the user has already seen the newest release", async () => {
		const fetchChangelog = vi.fn().mockResolvedValue(changelog(["0.2.0", "0.1.0"]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion="0.2.0"
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		expect(queryPanel()).toBeNull();
	});

	it("stays hidden when the bundled changelog is empty", async () => {
		const fetchChangelog = vi.fn().mockResolvedValue(changelog([]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		expect(queryPanel()).toBeNull();
	});

	it("stays hidden when the IPC fetch rejects", async () => {
		const fetchChangelog = vi.fn().mockRejectedValue(new Error("boom"));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		expect(queryPanel()).toBeNull();
	});

	it("clicking Got it records the newest version", async () => {
		const recordSeenVersion = vi.fn().mockResolvedValue(undefined);
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={() => Promise.resolve(changelog(["0.3.0", "0.2.0"]))}
					recordSeenVersion={recordSeenVersion}
				/>,
			),
		);
		await flushPromises();
		const dismissButton = buttonByText("Got it");
		expect(dismissButton).toBeDefined();
		act(() => dismissButton?.click());
		expect(recordSeenVersion).toHaveBeenCalledExactlyOnceWith("0.3.0");
	});

	it("does not surface the obsolete Open in Settings button", async () => {
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={() => Promise.resolve(changelog(["0.3.0"]))}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		expect(buttonByText("Open in Settings")).toBeUndefined();
	});

	it("decides once: prop flips after the first decision do not re-fetch or change the surfaced release", async () => {
		const recordSeenVersion = vi.fn().mockResolvedValue(undefined);
		const fetchChangelog = vi.fn().mockResolvedValue(changelog(["0.3.0", "0.2.0"]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={recordSeenVersion}
				/>,
			),
		);
		await flushPromises();
		expect(queryPanel()?.textContent).toContain("0.3.0");
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion="0.3.0"
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={recordSeenVersion}
				/>,
			),
		);
		await flushPromises();
		expect(queryPanel()?.textContent).toContain("0.3.0");
		expect(fetchChangelog).toHaveBeenCalledOnce();
	});

	it("decides once: snapshotReady flipping false→true after a no-popover decision does NOT re-decide", async () => {
		const fetchChangelog = vi.fn().mockResolvedValue(changelog(["0.3.0"]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion="0.3.0"
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		expect(queryPanel()).toBeNull();
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		expect(queryPanel()).toBeNull();
	});

	it("renders the editorial hero (icon + title + version) for the newest release", async () => {
		const fetchChangelog = vi.fn().mockResolvedValue(changelog(["1.0.0"]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		const panel = queryPanel();
		expect(panel?.querySelector(".whats-new-release__title")?.textContent).toBe("Release 1.0.0");
		expect(panel?.querySelector(".whats-new-release__icon")?.textContent).toBe("🎉");
		expect(panel?.querySelector(".whats-new-release__version")?.textContent).toBe("1.0.0");
	});

	it("Previous/Next pages through every release in the bundle (newest → oldest)", async () => {
		const fetchChangelog = vi.fn().mockResolvedValue(changelog(["0.3.0", "0.2.0", "0.1.0"]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		const titleText = () => queryPanel()?.querySelector(".whats-new-release__title")?.textContent;
		expect(titleText()).toBe("Release 0.3.0");
		const prev = container.ownerDocument.querySelector<HTMLButtonElement>(
			'[data-testid="whats-new-popover-prev"]',
		);
		const next = container.ownerDocument.querySelector<HTMLButtonElement>(
			'[data-testid="whats-new-popover-next"]',
		);
		expect(prev?.disabled).toBe(false);
		expect(next?.disabled).toBe(true);
		act(() => prev?.click());
		expect(titleText()).toBe("Release 0.2.0");
		act(() => prev?.click());
		expect(titleText()).toBe("Release 0.1.0");
		const prevAtOldest = container.ownerDocument.querySelector<HTMLButtonElement>(
			'[data-testid="whats-new-popover-prev"]',
		);
		expect(prevAtOldest?.disabled).toBe(true);
	});

	it("hides the page indicator when only one release is bundled", async () => {
		const fetchChangelog = vi.fn().mockResolvedValue(changelog(["0.3.0"]));
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={fetchChangelog}
					recordSeenVersion={vi.fn()}
				/>,
			),
		);
		await flushPromises();
		const panel = queryPanel();
		expect(panel?.querySelector(".whats-new-popover__pager-indicator")).toBeNull();
	});

	it("Got it after paging to an older release still records the NEWEST version", async () => {
		const recordSeenVersion = vi.fn().mockResolvedValue(undefined);
		act(() =>
			root.render(
				<WhatsNewPopover
					lastSeenChangelogVersion={null}
					snapshotReady={true}
					fetchChangelog={() => Promise.resolve(changelog(["0.3.0", "0.2.0"]))}
					recordSeenVersion={recordSeenVersion}
				/>,
			),
		);
		await flushPromises();
		const prev = container.ownerDocument.querySelector<HTMLButtonElement>(
			'[data-testid="whats-new-popover-prev"]',
		);
		act(() => prev?.click());
		const dismissButton = buttonByText("Got it");
		act(() => dismissButton?.click());
		expect(recordSeenVersion).toHaveBeenCalledExactlyOnceWith("0.3.0");
	});
});
