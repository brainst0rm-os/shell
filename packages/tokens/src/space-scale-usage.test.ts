import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultDark } from "./themes";
import { flattenTokens } from "./tokens";

// The `--space-*` scale is a fixed, numeric scale. A `var(--space-N)` for an N
// past the end of the scale is NOT a CSS error — it resolves to an undefined
// variable, which invalidates the whole declaration at computed-value time, so
// the rule is silently *dropped*. That's how `max-height: min(640px,
// calc(100vh - var(--space-10)))` shipped on the Bin panel with no max-height at
// all (the scale tops out at --space-8), letting the list grow unbounded. This
// guard fails the build the moment any renderer/app CSS references a space step
// that doesn't exist, instead of waiting for a screenshot.

const VALID_SPACE_VARS = new Set(
	Object.keys(flattenTokens(defaultDark)).filter((name) => name.startsWith("--space-")),
);

// Match any `--space-<suffix>`, alpha or numeric — the scale is numeric, so an
// alpha suffix (`--space-md`, `--space-xl`) is exactly the kind of undefined
// token this guard exists to catch. A digit-only pattern silently skipped them.
const SPACE_VAR_RE = /var\(\s*(--space-[a-z0-9][a-z0-9_]*)\b/g;

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const ROOTS = [`${REPO_ROOT}/packages`, `${REPO_ROOT}/apps`];

function cssFiles(dir: string): string[] {
	const out: string[] = [];
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return out;
	}
	for (const name of names) {
		if (name === "node_modules" || name === "out" || name === "dist") continue;
		const full = `${dir}/${name}`;
		if (statSync(full).isDirectory()) out.push(...cssFiles(full));
		else if (name.endsWith(".css")) out.push(full);
	}
	return out;
}

describe("space-scale CSS usage", () => {
	it("references only space steps that exist in the scale", () => {
		const offenders: string[] = [];
		for (const root of ROOTS) {
			for (const file of cssFiles(root)) {
				const css = readFileSync(file, "utf8");
				for (const match of css.matchAll(SPACE_VAR_RE)) {
					const token = match[1];
					if (token && !VALID_SPACE_VARS.has(token)) {
						offenders.push(`${file}: ${token}`);
					}
				}
			}
		}
		expect(
			offenders,
			`undefined --space-* references silently void their CSS declaration:\n${offenders.join("\n")}`,
		).toEqual([]);
	});
});
