import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button — loading / busy state", () => {
	it("renders the label and no spinner when idle", () => {
		const html = renderToStaticMarkup(<Button onClick={() => {}}>Save</Button>);
		expect(html).toContain('<span class="button__label">Save</span>');
		expect(html).not.toContain("button__spinner");
		expect(html).not.toContain("aria-busy");
		expect(html).not.toContain("disabled");
	});

	it("when loading: disabled + aria-busy + decorative spinner, label kept (size held)", () => {
		const html = renderToStaticMarkup(
			<Button loading onClick={() => {}}>
				Save
			</Button>,
		);
		expect(html).toContain("button--loading");
		expect(html).toContain("disabled");
		expect(html).toContain('aria-busy="true"');
		// Label stays in the DOM so the button keeps its width.
		expect(html).toContain('<span class="button__label">Save</span>');
		// Spinner is present but decorative — the button already
		// announces busy, so the loader must not double-announce.
		expect(html).toContain('class="button__spinner"');
		expect(html).toContain('aria-hidden="true"');
		expect(html).not.toContain('role="status"');
	});

	it("disabled prop alone also disables (independent of loading)", () => {
		const html = renderToStaticMarkup(
			<Button disabled onClick={() => {}}>
				Go
			</Button>,
		);
		expect(html).toContain("disabled");
		expect(html).not.toContain("aria-busy");
		expect(html).not.toContain("button__spinner");
	});

	it("loading is independent of an explicit disabled=false", () => {
		const html = renderToStaticMarkup(
			<Button loading disabled={false} onClick={() => {}}>
				Go
			</Button>,
		);
		// loading still forces the disabled attribute (can't double-fire).
		expect(html).toContain("disabled");
		expect(html).toContain('aria-busy="true"');
	});
});

describe("Button — shortcutId (6.10d)", () => {
	it("omits the hint + aria-keyshortcuts when shortcutId is absent", () => {
		const html = renderToStaticMarkup(<Button onClick={() => {}}>Save</Button>);
		expect(html).not.toContain("button__shortcut");
		expect(html).not.toContain("button__key");
		expect(html).not.toContain("aria-keyshortcuts");
	});

	it("renders kbd hint + stamps aria-keyshortcuts for a known id", () => {
		const html = renderToStaticMarkup(
			<Button shortcutId="shell/cheatsheet" onClick={() => {}}>
				Show shortcuts
			</Button>,
		);
		// aria-keyshortcuts carries the CANONICAL chord string (assistive
		// tech reads it verbatim), NOT the visual glyphs.
		expect(html).toContain('aria-keyshortcuts="CmdOrCtrl+Shift+K"');
		// Hint wrapper is aria-hidden (decorative; the canonical chord is
		// the announcement source).
		expect(html).toContain('class="button__shortcut" aria-hidden="true"');
		// Glyphs reflect the test-runner platform (mac → ⌘⇧K, pc →
		// Ctrl/Shift/K). The trailing letter is platform-invariant.
		expect(html).toMatch(
			/<kbd class="button__key">(⌘|Ctrl)<\/kbd><kbd class="button__key">(⇧|Shift)<\/kbd><kbd class="button__key">K<\/kbd>/,
		);
	});

	it("omits the hint when the id is unknown (no empty kbd)", () => {
		const html = renderToStaticMarkup(
			<Button shortcutId="nonexistent/action" onClick={() => {}}>
				Save
			</Button>,
		);
		expect(html).not.toContain("button__shortcut");
		expect(html).not.toContain("aria-keyshortcuts");
	});

	it("still renders icons + label alongside the hint", () => {
		const html = renderToStaticMarkup(
			<Button shortcutId="shell/launcher" onClick={() => {}}>
				Open launcher
			</Button>,
		);
		expect(html).toContain('class="button__label">Open launcher<');
		expect(html).toContain("button__shortcut");
		expect(html).toContain("aria-keyshortcuts=");
	});

	it("hides the hint visually under the loading state (kept in DOM for size)", () => {
		const html = renderToStaticMarkup(
			<Button shortcutId="shell/cheatsheet" loading onClick={() => {}}>
				Show shortcuts
			</Button>,
		);
		// The wrapper still renders so the button keeps width; CSS
		// `.button--loading > .button__shortcut { visibility: hidden }`
		// handles the visual hide. Pin the structure here.
		expect(html).toContain("button__shortcut");
		expect(html).toContain("button--loading");
	});
});
