// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	BLOCK_FRAME_BOOTSTRAP_GLOBAL,
	BLOCK_FRAME_CSP,
	BLOCK_FRAME_ROOT_ID,
	BLOCK_FRAME_SANDBOX,
	BLOCK_FRAME_SRCDOC,
	type BlockFrameHandle,
	BlockFramePhase,
	buildBlockSrcdoc,
	createBlockFrame,
	makeBlockFrameUrl,
} from "./index";

// jsdom has no IntersectionObserver; createBlockFrame fails closed (stays
// Paused) without one, which is fine — these tests assert on the srcdoc
// attribute the frame is built with, not on phase transitions.
class NoopIntersectionObserver {
	observe(): void {}
	unobserve(): void {}
	disconnect(): void {}
}

const IO = NoopIntersectionObserver as unknown as typeof IntersectionObserver;

describe("buildBlockSrcdoc — pinned shell + app script", () => {
	const script = "globalThis.__ran = true;";
	const bootstrap = { channelId: "chan-123", entityId: "ent-abc" };

	it("carries the full pinned CSP, charset, referrer, and base target", () => {
		const html = buildBlockSrcdoc(script, bootstrap);
		expect(html).toContain(
			`<meta http-equiv="Content-Security-Policy" content="${BLOCK_FRAME_CSP}">`,
		);
		expect(html).toContain('<meta charset="utf-8">');
		expect(html).toContain('<meta name="referrer" content="no-referrer">');
		expect(html).toContain('<base target="_self">');
	});

	it("inlines the block script verbatim and provides the mount root", () => {
		const html = buildBlockSrcdoc(script, bootstrap);
		expect(html).toContain(`<div id="${BLOCK_FRAME_ROOT_ID}"></div>`);
		expect(html).toContain(`<script>${script}</script>`);
	});

	it("freezes the routing bootstrap (channelId + entityId) onto the global", () => {
		const html = buildBlockSrcdoc(script, bootstrap);
		expect(html).toContain(`window.${BLOCK_FRAME_BOOTSTRAP_GLOBAL}=Object.freeze(JSON.parse(`);
		// The values reach the global as a JSON-parsed, double-encoded literal.
		expect(html).toContain("chan-123");
		expect(html).toContain("ent-abc");
	});

	it("never emits a raw </script> from a hostile entityId (script-context escape)", () => {
		const hostile = { channelId: "c", entityId: "</script><script>alert(1)</script>" };
		const html = buildBlockSrcdoc(script, hostile);
		// The ONLY literal </script> tokens are the two legitimate closers
		// (bootstrap script + block script). The hostile entityId's </script>
		// is neutralised to </script>.
		const rawClosers = html.match(/<\/script>/g) ?? [];
		expect(rawClosers.length).toBe(2);
		expect(html).toContain("\\u003c/script>");
		expect(html).not.toContain("<script>alert(1)</script>");
	});

	it("carries no src= and no network-y attributes (it is a srcdoc body only)", () => {
		const html = buildBlockSrcdoc(script, bootstrap);
		expect(html).not.toContain("http://");
		expect(html).not.toContain("https://");
		expect(html).not.toMatch(/\ssrc=/);
	});
});

describe("createBlockFrame — bundle injection vs stub", () => {
	let container: HTMLElement;
	const handles: BlockFrameHandle[] = [];

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});
	afterEach(() => {
		for (const h of handles) h.destroy();
		handles.length = 0;
		container.remove();
	});

	function build(extra: Partial<Parameters<typeof createBlockFrame>[0]> = {}): BlockFrameHandle {
		const h = createBlockFrame({ container, IntersectionObserverImpl: IO, ...extra });
		handles.push(h);
		return h;
	}

	it("loads the bsblock:// bundle URL when blockId + bootstrap are supplied", () => {
		const h = build({
			blockId: "io.example.db/grid",
			bootstrap: { channelId: "c1", entityId: "e1" },
		});
		const src = h.iframe.getAttribute("src") ?? "";
		// The document loads from the block's own origin (escapes the embedder
		// CSP); it is NOT a srcdoc.
		expect(src).toBe(makeBlockFrameUrl("io.example.db/grid", { channelId: "c1", entityId: "e1" }));
		expect(src.startsWith("bsblock://frame/")).toBe(true);
		expect(src).toContain("b=io.example.db%2Fgrid");
		expect(src).toContain("c=c1");
		expect(src).toContain("e=e1");
		expect(h.iframe.hasAttribute("srcdoc")).toBe(false);
	});

	it("keeps the inert stub srcdoc (no src) when blockId is omitted", () => {
		const h = build();
		expect(h.iframe.getAttribute("srcdoc")).toBe(BLOCK_FRAME_SRCDOC);
		expect(h.iframe.hasAttribute("src")).toBe(false);
	});

	it("keeps the inert stub when blockId is present but bootstrap is missing", () => {
		// A bundle frame with no routing identity could never establish its
		// transport; fail closed to the stub rather than mount a dead frame.
		const h = build({ blockId: "io.example.db/grid" });
		expect(h.iframe.getAttribute("srcdoc")).toBe(BLOCK_FRAME_SRCDOC);
		expect(h.iframe.hasAttribute("src")).toBe(false);
	});

	it("the bundle frame keeps EVERY pinned security attribute", () => {
		const h = build({ blockId: "io.example.db/grid", bootstrap: { channelId: "c", entityId: "e" } });
		expect(h.iframe.getAttribute("sandbox")).toBe(BLOCK_FRAME_SANDBOX);
		expect(h.iframe.getAttribute("allow")).toBe("");
		expect(h.iframe.getAttribute("referrerpolicy")).toBe("no-referrer");
		// jsdom never intersects → frame stays Paused (fail-closed default).
		expect(h.getPhase()).toBe(BlockFramePhase.Paused);
	});

	it("buildBlockSrcdoc (used by the shell handler) still carries the pinned CSP", () => {
		// The renderer no longer inlines the bundle; the shell's bsblock://
		// handler does, via buildBlockSrcdoc. Pin that it still emits the CSP.
		const html = buildBlockSrcdoc("/* bundle */ void 0;", { channelId: "c", entityId: "e" });
		expect(html).toContain(`content="${BLOCK_FRAME_CSP}"`);
		expect(html).toContain("/* bundle */ void 0;");
	});
});
