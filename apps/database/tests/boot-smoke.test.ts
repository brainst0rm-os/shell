/**
 * @vitest-environment jsdom
 *
 * REAL-DOM boot smoke test.
 *
 * The first version of this test set an EMPTY `document.body`, so every
 * render function early-returned on a null `getElementById` — it passed
 * while the live app still crashed in the render path with a TDZ
 * (`Cannot access X before initialization`). The fix: load the app's
 * actual `index.html` body so the render + handler-binding code that
 * `bootApp()` runs at module-eval actually executes — exactly the path
 * that broke for the user. A module-scope `let` declared after the
 * top-level `bootApp()` call now fails this test.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const INDEX_HTML = readFileSync(join(__dirname, "../src/index.html"), "utf8");
const BODY_HTML = INDEX_HTML.replace(/[\s\S]*<body[^>]*>/i, "").replace(/<\/body>[\s\S]*/i, "");

describe("Database app boots without a module-eval / render-path crash", () => {
	beforeEach(() => {
		vi.resetModules();
		(window as { brainstorm?: unknown }).brainstorm = undefined;
		if (!("ResizeObserver" in window)) {
			(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
				observe() {}
				unobserve() {}
				disconnect() {}
			};
		}
		if (!window.matchMedia) {
			(window as unknown as { matchMedia: unknown }).matchMedia = () => ({
				matches: false,
				addEventListener() {},
				removeEventListener() {},
			});
		}
		// The REAL app DOM, so render functions actually run (the empty-body
		// version masked the render-path TDZ that crash-looped the app).
		document.body.innerHTML = BODY_HTML;
	});

	it("evaluating app.ts (bootApp → real render + bind) throws no ReferenceError/TDZ", async () => {
		await expect(import("../src/app")).resolves.toBeDefined();
		// bootApp() mounts React roots (menu host, comments panel) this test
		// has no handle to unmount. Drain React's scheduler inside the jsdom
		// environment so no `performWorkUntilDeadline` macrotask survives to
		// fire after vitest tears jsdom down — that fires with `window`
		// undefined, an uncaught exception that reds the whole run.
		for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
	}, 30_000); // under contention. 30s leaves headroom without masking real hangs. // Shiki — transform on a cold worker can blow past vitest's 5s default // app.ts pulls in the full renderer + every linked SDK + Lexical/Pixi/
});
