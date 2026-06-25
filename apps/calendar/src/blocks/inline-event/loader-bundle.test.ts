import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * App-local proof that the `inline-event` block is loader-mountable: the
 * build emits the bundle to the exact path the shell's installer reads
 * (`dist/blocks/<block-id-last-segment>.js`) and the artifact is the
 * self-contained IIFE the `bsblock://` loader serves into the frame. The
 * generic install→serve path itself is covered by the shell's
 * `block-bundle-loader.test.ts`; this binds Calendar's specific block id
 * to that contract.
 *
 * Skips (rather than fails) when the bundle hasn't been built yet so a
 * source-only `bun run test` stays green; CI's verify runs the build
 * first, and `bun run build` in this app emits it.
 */

const BLOCK_ID = "io.brainstorm.calendar/inline-event";
const BLOCK_NAME = BLOCK_ID.split("/").at(-1) ?? "";
const BUNDLE_PATH = join(__dirname, "..", "..", "..", "dist", "blocks", `${BLOCK_NAME}.js`);

describe("inline-event loader bundle", () => {
	it("derives the dist path from the block id's last segment", () => {
		expect(BLOCK_NAME).toBe("inline-event");
		expect(BUNDLE_PATH.endsWith(join("dist", "blocks", "inline-event.js"))).toBe(true);
	});

	it.skipIf(!existsSync(BUNDLE_PATH))(
		"emits a self-contained IIFE that boots the block runtime",
		() => {
			const source = readFileSync(BUNDLE_PATH, "utf8");
			expect(source.length).toBeGreaterThan(0);
			// Built as an IIFE (no module loader / network in the jail), and the
			// block-runtime bootstrap that actually registers the render code is
			// inlined — i.e. serving this string runs the block.
			expect(source).toMatch(/postMessage/);
			expect(source).not.toMatch(/\bimport\s+[^(]/);
			expect(source).not.toMatch(/\brequire\(/);
		},
	);
});
