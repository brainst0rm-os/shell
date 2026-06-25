import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIRST_PARTY_APPS } from "./first-party";
import { validateManifest } from "./manifest";

// `apps/` relative to this test file: packages/shell/src/main/apps → repo
// root is five levels up.
const APPS_DIR = join(__dirname, "..", "..", "..", "..", "..", "apps");

/**
 * Every catalog entry must point at a real, valid manifest whose id matches
 * the declared `expectedAppId`. One on-disk check for all first-party apps —
 * the stub apps (Theme Editor, Books, …) get the same guard as the built
 * ones without a per-app manifest test copied 8 times.
 */
describe("first-party app manifests on disk", () => {
	for (const app of FIRST_PARTY_APPS) {
		it(`${app.dir}: manifest validates and id matches the catalog`, () => {
			const raw = readFileSync(join(APPS_DIR, app.dir, "manifest.json"), "utf8");
			const result = validateManifest(JSON.parse(raw));
			if (!result.ok) {
				throw new Error(`${app.dir} manifest invalid at ${result.path}: ${result.reason}`);
			}
			expect(result.manifest.id).toBe(app.expectedAppId);
			expect(result.manifest.sdk).toBe("1");
		});
	}
});
