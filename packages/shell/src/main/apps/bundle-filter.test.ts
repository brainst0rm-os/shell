import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEV_ONLY_TOP_LEVEL_NAMES, shouldCopyBundleEntry } from "./bundle-filter";

const BUNDLE = "/tmp/apps/notes";

describe("shouldCopyBundleEntry", () => {
	it("copies the bundle root itself", () => {
		expect(shouldCopyBundleEntry(BUNDLE, BUNDLE)).toBe(true);
	});

	it("copies manifest, entry bundle, and asset references", () => {
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "manifest.json"))).toBe(true);
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "dist"))).toBe(true);
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "dist/index.html"))).toBe(true);
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "icon.svg"))).toBe(true);
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "assets/icon.png"))).toBe(true);
	});

	it("skips node_modules — the proximate cause of the cp-into-self EINVAL", () => {
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "node_modules"))).toBe(false);
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "node_modules/typescript"))).toBe(false);
		expect(
			shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "node_modules/typescript/node_modules/typescript")),
		).toBe(false);
	});

	it("skips dev-tooling top-level entries", () => {
		const skipped = ["src", "tests", ".git", "package.json", "tsconfig.json", "vite.config.ts"];
		for (const name of skipped) {
			expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, name))).toBe(false);
		}
	});

	it("allows nested children of allowed top-level entries even when their basename overlaps a denylisted name", () => {
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "dist/node_modules"))).toBe(true);
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "dist/src/main.js"))).toBe(true);
		expect(shouldCopyBundleEntry(BUNDLE, join(BUNDLE, "assets/test/icon.png"))).toBe(true);
	});

	it("ships paths outside the bundle dir unchanged (defensive)", () => {
		expect(shouldCopyBundleEntry(BUNDLE, "/tmp/somewhere/else")).toBe(true);
	});

	it("exposes the canonical denylist for documentation / cross-checking", () => {
		expect(DEV_ONLY_TOP_LEVEL_NAMES.has("node_modules")).toBe(true);
		expect(DEV_ONLY_TOP_LEVEL_NAMES.has("dist")).toBe(false);
	});
});
