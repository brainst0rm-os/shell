import { describe, expect, it } from "vitest";
import { RenameError, nextUntitledPath, validateRenamePath } from "./new-file";

describe("nextUntitledPath", () => {
	it("first new file is untitled.ts", () => {
		expect(nextUntitledPath([])).toBe("untitled.ts");
		expect(nextUntitledPath(["main.ts"])).toBe("untitled.ts");
	});

	it("avoids collisions, case-insensitively", () => {
		expect(nextUntitledPath(["untitled.ts"])).toBe("untitled-2.ts");
		expect(nextUntitledPath(["Untitled.ts", "untitled-2.ts"])).toBe("untitled-3.ts");
	});
});

describe("validateRenamePath", () => {
	it("trims and accepts a fresh name", () => {
		expect(validateRenamePath("  app.ts  ", "untitled.ts", ["untitled.ts", "main.ts"])).toEqual({
			ok: true,
			path: "app.ts",
		});
	});

	it("rejects an empty / whitespace-only name", () => {
		expect(validateRenamePath("   ", "untitled.ts", [])).toEqual({
			ok: false,
			reason: RenameError.Empty,
		});
	});

	it("rejects a case-insensitive collision with a different file", () => {
		expect(validateRenamePath("Main.ts", "untitled.ts", ["untitled.ts", "main.ts"])).toEqual({
			ok: false,
			reason: RenameError.Duplicate,
		});
	});

	it("allows renaming a file to a re-cased spelling of its own path", () => {
		expect(validateRenamePath("Main.ts", "main.ts", ["main.ts"])).toEqual({
			ok: true,
			path: "Main.ts",
		});
	});

	it("strips control / bidi-override / zero-width characters from the name", () => {
		expect(validateRenamePath("a‮b.ts​", "untitled.ts", [])).toEqual({
			ok: true,
			path: "ab.ts",
		});
	});

	it("clamps an over-long name to the 200-char cap", () => {
		const result = validateRenamePath(`${"x".repeat(5000)}.ts`, "untitled.ts", []);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.path.length).toBe(200);
	});

	it("rejects a name that is only spoofing characters", () => {
		expect(validateRenamePath("‮​", "untitled.ts", [])).toEqual({
			ok: false,
			reason: RenameError.Empty,
		});
	});
});
