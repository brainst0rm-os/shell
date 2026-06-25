/**
 * `IconButton` tests — focused on the `shortcutId` extension (6.10d
 * follow-on, applied to the icon-only primitive).
 *
 * Icon-only buttons have no room for an inline `<kbd>` hint like
 * `<Button>` does, so the hook augments the tooltip to `"<label> (⌘⇧K)"`
 * and stamps `aria-keyshortcuts` for assistive tech.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconName } from "./icon";
import { IconButton } from "./icon-button";

describe("IconButton — base behaviour", () => {
	it("renders aria-label and data-bs-tooltip=label by default", () => {
		const html = renderToStaticMarkup(<IconButton icon={IconName.Settings} label="Open settings" />);
		expect(html).toContain('aria-label="Open settings"');
		expect(html).toContain('data-bs-tooltip="Open settings"');
		expect(html).not.toContain("aria-keyshortcuts");
	});

	it("an explicit `title` prop overrides the label-default tooltip", () => {
		const html = renderToStaticMarkup(
			<IconButton icon={IconName.Settings} label="Open settings" title="Settings (Cmd+,)" />,
		);
		expect(html).toContain('data-bs-tooltip="Settings (Cmd+,)"');
	});
});

describe("IconButton — shortcutId (6.10d follow-on)", () => {
	it("augments the tooltip with the platform-formatted chord", () => {
		const html = renderToStaticMarkup(
			<IconButton
				icon={IconName.Keyboard}
				label="Open shortcuts cheatsheet"
				shortcutId="shell/cheatsheet"
			/>,
		);
		// Label and chord are separate attrs — the host renders the chord dimmed.
		expect(html).toContain('data-bs-tooltip="Open shortcuts cheatsheet"');
		expect(html).toMatch(/data-bs-tooltip-shortcut="(⌘⇧K|CtrlShiftK)"/);
		// ARIA carries the canonical chord (not the visual glyphs).
		expect(html).toContain('aria-keyshortcuts="CmdOrCtrl+Shift+K"');
	});

	it("explicit `title` wins over the chord-augmented default", () => {
		const html = renderToStaticMarkup(
			<IconButton
				icon={IconName.Keyboard}
				label="Cheatsheet"
				title="Custom tooltip text"
				shortcutId="shell/cheatsheet"
			/>,
		);
		expect(html).toContain('data-bs-tooltip="Custom tooltip text"');
		// An explicit title suppresses the chord segment…
		expect(html).not.toContain("data-bs-tooltip-shortcut");
		// …but ARIA still carries the shortcut (callers shouldn't lose the
		// announcement just because they overrode the visible tooltip).
		expect(html).toContain('aria-keyshortcuts="CmdOrCtrl+Shift+K"');
	});

	it("unknown shortcutId leaves tooltip + ARIA unchanged", () => {
		const html = renderToStaticMarkup(
			<IconButton
				icon={IconName.Storefront}
				label="Open marketplace"
				shortcutId="nonexistent/action"
			/>,
		);
		expect(html).toContain('data-bs-tooltip="Open marketplace"');
		expect(html).not.toContain("aria-keyshortcuts");
	});

	it("no shortcutId at all leaves tooltip + ARIA unchanged", () => {
		const html = renderToStaticMarkup(<IconButton icon={IconName.Plus} label="Pin to dashboard" />);
		expect(html).toContain('data-bs-tooltip="Pin to dashboard"');
		expect(html).not.toContain("aria-keyshortcuts");
	});

	it("preserves `aria-pressed` and `pressed`-class behaviour alongside shortcutId", () => {
		const html = renderToStaticMarkup(
			<IconButton icon={IconName.Trash} label="Open bin" shortcutId="shell/bin" pressed />,
		);
		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain("icon-button--on");
		expect(html).toContain('aria-keyshortcuts="CmdOrCtrl+Shift+B"');
	});
});
