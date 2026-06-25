/**
 * Editor icons are decorative — the buttons/menu items that host them carry
 * the accessible name. Each glyph must therefore stay hidden from assistive
 * tech and out of the tab order. The phosphor-react migration silently
 * dropped the `aria-hidden`/`focusable` guard the hand-rolled SVGs had; this
 * pins it back so AT users don't hear spurious graphics for every adornment.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoldIcon, MoreIcon, ParagraphIcon, TodoListIcon } from "./icons";

describe("editor icons a11y", () => {
	it("marks every glyph aria-hidden and non-focusable", () => {
		for (const Icon of [ParagraphIcon, BoldIcon, TodoListIcon, MoreIcon]) {
			const html = renderToStaticMarkup(<Icon />);
			expect(html).toContain('aria-hidden="true"');
			expect(html).toContain('focusable="false"');
		}
	});
});
