/**
 * `createT` interpolation + override behaviour. This is the app-side `t()`
 * every app uses to kill bare strings, so the contract is pinned: typed
 * lookup, `{name}` interpolation, override layer, visible missing-key.
 */

import { describe, expect, it } from "vitest";
import { createT, plural } from "./common-labels";

const MANIFEST: Record<string, string> = {
	hello: "Hello",
	greet: "Hi {name}!",
	count: "{n} of {total}",
	literal: "100% sure {keep} {missing}",
	"step.one": "{count} step",
	"step.other": "{count} steps",
	"blocked.one": "{count} tracker on {site}",
	"blocked.other": "{count} trackers on {site}",
};

describe("createT", () => {
	it("returns the manifest string verbatim with no params", () => {
		const t = createT(MANIFEST);
		expect(t("hello")).toBe("Hello");
	});

	it("interpolates {name}-style params (string + number)", () => {
		const t = createT(MANIFEST);
		expect(t("greet", { name: "Ada" })).toBe("Hi Ada!");
		expect(t("count", { n: 1, total: 9 })).toBe("1 of 9");
	});

	it("leaves unknown placeholders intact and ignores extra params", () => {
		const t = createT(MANIFEST);
		expect(t("literal", { keep: "K" })).toBe("100% sure K {missing}");
	});

	it("applies a partial override over the defaults", () => {
		const t = createT(MANIFEST, { hello: "Hola", greet: "¡Hola {name}!" });
		expect(t("hello")).toBe("Hola");
		expect(t("greet", { name: "Sol" })).toBe("¡Hola Sol!");
		expect(t("count", { n: 2, total: 3 })).toBe("2 of 3");
	});

	it("degrades a missing key (only reachable via cast) to the key string", () => {
		const t = createT(MANIFEST);
		expect(t("nope")).toBe("nope");
	});
});

describe("plural", () => {
	const t = createT(MANIFEST);

	it("selects the .one form at exactly 1 and injects {count}", () => {
		expect(plural(t, 1, "step.one", "step.other")).toBe("1 step");
	});

	it("selects the .other form at 0 and >1", () => {
		expect(plural(t, 0, "step.one", "step.other")).toBe("0 steps");
		expect(plural(t, 5, "step.one", "step.other")).toBe("5 steps");
	});

	it("never leaks a raw ICU template (the F-162 regression)", () => {
		// createT is {name}-only; an ICU plural string would leak verbatim. The
		// plural() helper is the sanctioned path, so its output is plain text.
		const out = plural(t, 3, "step.one", "step.other");
		expect(out).not.toContain("plural");
		expect(out).not.toContain("{");
	});

	it("passes extra params through alongside the injected count", () => {
		expect(plural(t, 1, "blocked.one", "blocked.other", { site: "example.com" })).toBe(
			"1 tracker on example.com",
		);
		expect(plural(t, 4, "blocked.one", "blocked.other", { site: "example.com" })).toBe(
			"4 trackers on example.com",
		);
	});
});
