import { describe, expect, it } from "vitest";
import { defaultChordFor } from "./default-chords";

describe("default-chords", () => {
	it("resolves a known id and returns null for an unknown one", () => {
		expect(defaultChordFor("app/nav.back")).toBe("CmdOrCtrl+[");
		expect(defaultChordFor("does/not.exist")).toBeNull();
	});

	it("carries the in-document find & replace contract (B9.1c)", () => {
		expect(defaultChordFor("editor/find")).toBe("CmdOrCtrl+F");
		expect(defaultChordFor("editor/find.replace")).toBe("CmdOrCtrl+Alt+F");
		expect(defaultChordFor("editor/find.next")).toBe("CmdOrCtrl+G");
		expect(defaultChordFor("editor/find.previous")).toBe("CmdOrCtrl+Shift+G");
		expect(defaultChordFor("editor/find.close")).toBe("Escape");
	});
});
