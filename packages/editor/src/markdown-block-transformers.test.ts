import { CHECK_LIST } from "@lexical/markdown";
import { describe, expect, it } from "vitest";
import { BLOCK_MARKDOWN_TRANSFORMERS, HR_TRANSFORMER } from "./markdown-block-transformers";

describe("block markdown transformers", () => {
	it("HR_TRANSFORMER matches the rule syntaxes — incl. the em-dash-mangled forms", () => {
		// `—-` / `——` are what Notes' `--`→`—` typing shortcut leaves a typed
		// `---` / `----` as; matching them keeps the divider gesture working there.
		for (const rule of ["---", "***", "___", "—-", "——"]) {
			expect(HR_TRANSFORMER.regExp.test(rule)).toBe(true);
		}
		expect(HR_TRANSFORMER.regExp.test("--")).toBe(false);
		expect(HR_TRANSFORMER.regExp.test("—")).toBe(false); // a lone em-dash is intentional text
		expect(HR_TRANSFORMER.regExp.test("text---")).toBe(false);
	});

	it("HR_TRANSFORMER is an element transformer", () => {
		expect(HR_TRANSFORMER.type).toBe("element");
	});

	it("prepends CHECK_LIST before HR so `- [ ] ` resolves to a checklist, not a bullet", () => {
		// CHECK_LIST must come first in the combined list (before the default
		// UNORDERED_LIST that ships in TRANSFORMERS) — order is load-bearing.
		expect(BLOCK_MARKDOWN_TRANSFORMERS[0]).toBe(CHECK_LIST);
		expect(BLOCK_MARKDOWN_TRANSFORMERS).toContain(HR_TRANSFORMER);
	});
});
