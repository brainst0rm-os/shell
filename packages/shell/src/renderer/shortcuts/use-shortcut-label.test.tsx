/**
 * `useShortcutLabel` tests — render the hook through a tiny harness
 * component (a hook can't be called outside React) and assert the
 * returned shape via the rendered output.
 */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useShortcutLabel } from "./use-shortcut-label";

function Probe({ id }: { id: string }) {
	const label = useShortcutLabel(id);
	if (label === null) return <span data-test="empty" />;
	return <span data-test="ok" data-chord={label.chord} data-tokens={label.tokens.join("|")} />;
}

describe("useShortcutLabel", () => {
	it("returns chord + tokens for a known shell action", () => {
		const html = renderToString(<Probe id="shell/cheatsheet" />);
		expect(html).toContain('data-test="ok"');
		expect(html).toContain('data-chord="CmdOrCtrl+Shift+K"');
		// Glyphs reflect the test-runner's platform (the dev box's
		// `navigator.platform`). Both mac and pc renderings are valid;
		// pin the load-bearing chord string + the token-count contract.
		expect(html).toMatch(/data-tokens="(⌘\|⇧\|K|Ctrl\|Shift\|K)"/);
	});

	it("returns null for an unknown id", () => {
		const html = renderToString(<Probe id="nonexistent/action" />);
		expect(html).toContain('data-test="empty"');
	});

	it("returns null for an empty id (the `<Button>` no-shortcut sentinel)", () => {
		const html = renderToString(<Probe id="" />);
		expect(html).toContain('data-test="empty"');
	});

	it("returns chord + tokens for an editor action", () => {
		const html = renderToString(<Probe id="editor/find" />);
		expect(html).toContain('data-chord="CmdOrCtrl+F"');
		expect(html).toMatch(/data-tokens="(⌘\|F|Ctrl\|F)"/);
	});
});
