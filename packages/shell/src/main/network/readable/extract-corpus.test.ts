/**
 * Net-2d — fixture-corpus golden tests. Runs the full extraction substrate
 * (extract → sanitize → blocks) over a corpus of representative pages and
 * compares against committed `.golden.json` baselines, so any drift in the
 * pipeline output is caught. Fixtures are in-repo snapshots, never re-fetched;
 * each `.url` sidecar records provenance for human review only.
 *
 * Regenerate goldens after an intentional change:
 *   BRAINSTORM_UPDATE_GOLDEN=1 bun --bun vitest run .../extract-corpus.test.ts
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractReadable } from "./extract-html";
import type { ReadableMeta } from "./extract-html";
import { type SerializedBlock, htmlToSerializedBlocks } from "./html-to-blocks";
import { sanitizeReadableHtml } from "./sanitize-html";

const UPDATE = process.env.BRAINSTORM_UPDATE_GOLDEN === "1";
const corpusDir = fileURLToPath(new URL("./corpus", import.meta.url));

type CorpusResult = { meta: ReadableMeta | null; blocks: SerializedBlock[] | null };

/** The composed substrate, exactly what the extraction worker runs. */
function runPipeline(html: string, baseUrl: string): CorpusResult {
	const article = extractReadable(html, baseUrl);
	if (article === null) return { meta: null, blocks: null };
	return { meta: article.meta, blocks: htmlToSerializedBlocks(sanitizeReadableHtml(article.html)) };
}

const htmlFiles = readdirSync(corpusDir)
	.filter((f) => f.endsWith(".html"))
	.sort();

describe("readable corpus", () => {
	it("has fixtures", () => {
		expect(htmlFiles.length).toBeGreaterThan(0);
	});

	it("every .html has a .url + .golden.json sidecar (no orphans)", () => {
		for (const f of htmlFiles) {
			const base = f.replace(/\.html$/, "");
			expect(existsSync(join(corpusDir, `${base}.url`)), `${base}.url missing`).toBe(true);
			if (!UPDATE) {
				expect(existsSync(join(corpusDir, `${base}.golden.json`)), `${base}.golden.json missing`).toBe(
					true,
				);
			}
		}
		// Reverse: no golden/url without its html.
		for (const f of readdirSync(corpusDir)) {
			const base = f.replace(/\.(golden\.json|url|html)$/, "");
			expect(htmlFiles.includes(`${base}.html`), `orphan sidecar: ${f}`).toBe(true);
		}
	});

	for (const f of htmlFiles) {
		const base = f.replace(/\.html$/, "");
		it(`${base} extracts to its golden`, () => {
			const html = readFileSync(join(corpusDir, f), "utf8");
			const url = readFileSync(join(corpusDir, `${base}.url`), "utf8").trim();
			const result = runPipeline(html, url);
			const goldenPath = join(corpusDir, `${base}.golden.json`);
			if (UPDATE) {
				writeFileSync(goldenPath, `${JSON.stringify(result, null, 2)}\n`);
				return;
			}
			const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as CorpusResult;
			expect(result).toEqual(golden);
		});
	}
});
