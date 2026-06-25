import { describe, expect, it } from "vitest";
import type { ExtractionResult } from "./index";
import { handleExtractionEnvelope, handleParentPortMessage } from "./index";

const baseEnvelope = (method: string, args: unknown[] = [], service = "extraction") => ({
	v: 1 as const,
	msg: `m-${Math.random().toString(36).slice(2, 10)}`,
	app: "_shell",
	service,
	method,
	args,
	caps: [] as string[],
});

const PROSE =
	"<p>The quick brown fox jumps over the lazy dog. Readability scores paragraphs by the density of text versus link markup, so the article needs genuine prose to be selected as the main column over the page chrome.</p>".repeat(
		4,
	);
const ARTICLE = `<!doctype html><html lang="en"><head><title>Doc</title></head><body>
	<nav>menu</nav><article><h1>Real Heading</h1>${PROSE}</article><footer>cookie banner</footer></body></html>`;

const okValue = (reply: Awaited<ReturnType<typeof handleExtractionEnvelope>>): ExtractionResult => {
	if (!reply.ok) throw new Error(`expected ok reply, got error: ${reply.error.message}`);
	return reply.value as ExtractionResult;
};

describe("handleExtractionEnvelope", () => {
	it("extracts → meta + blocks for a real article", async () => {
		const reply = await handleExtractionEnvelope(
			baseEnvelope("extract", [{ html: ARTICLE, baseUrl: "https://x.test/post" }]),
		);
		const value = okValue(reply);
		expect(value.blocks).not.toBeNull();
		expect(value.blocks?.some((b) => b.type === "heading")).toBe(true);
		expect(value.meta?.title).toBeTruthy();
		expect(value.textContent).toContain("quick brown fox");
	});

	it("returns blocks: null for a page with no article", async () => {
		const shell = '<!doctype html><html><body><div id="root"></div></body></html>';
		const value = okValue(
			await handleExtractionEnvelope(
				baseEnvelope("extract", [{ html: shell, baseUrl: "https://spa.test" }]),
			),
		);
		expect(value.blocks).toBeNull();
		expect(value.meta).toBeNull();
	});

	it("never leaks <script> content into blocks", async () => {
		const evil = `<!doctype html><html><body><article><h1>H</h1>${PROSE}<script>steal()</script></article></body></html>`;
		const value = okValue(
			await handleExtractionEnvelope(
				baseEnvelope("extract", [{ html: evil, baseUrl: "https://x.test" }]),
			),
		);
		expect(JSON.stringify(value.blocks)).not.toContain("steal");
	});

	it("coerces missing/invalid args to an empty extraction (no throw)", async () => {
		const value = okValue(await handleExtractionEnvelope(baseEnvelope("extract", [{}])));
		expect(value.blocks).toBeNull();
	});

	it("answers ping", async () => {
		const reply = await handleExtractionEnvelope(baseEnvelope("ping", [42]));
		expect(reply.ok).toBe(true);
		if (reply.ok) expect((reply.value as { pong: number }).pong).toBe(42);
	});

	it("rejects an envelope routed to the wrong service", async () => {
		const reply = await handleExtractionEnvelope(baseEnvelope("extract", [{}], "storage"));
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("reports an unimplemented method as Unavailable", async () => {
		const reply = await handleExtractionEnvelope(baseEnvelope("nope"));
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Unavailable");
	});

	it("rejects a malformed (non-envelope) payload as Invalid", async () => {
		const reply = await handleExtractionEnvelope({ not: "an envelope" });
		expect(reply.ok).toBe(false);
		if (!reply.ok) expect(reply.error.kind).toBe("Invalid");
	});

	it("handleParentPortMessage unwraps the MessageEvent .data and routes", async () => {
		const reply = await handleParentPortMessage({
			data: baseEnvelope("extract", [{ html: ARTICLE, baseUrl: "https://x.test" }]),
		});
		expect(reply.ok).toBe(true);
	});
});
