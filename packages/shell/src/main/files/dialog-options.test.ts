import { describe, expect, it } from "vitest";
import {
	normalizeExtensions,
	normalizeFilters,
	normalizeOpenDialog,
	normalizeSaveDialog,
	sanitizeSuggestedName,
} from "./dialog-options";
import { FileHandleMode } from "./file-handle-registry";

const CTRL = String.fromCharCode(0); // NUL, never typed literally

describe("normalizeExtensions", () => {
	it("lowercases, strips leading dots, de-dupes (stable), keeps `*`", () => {
		expect(normalizeExtensions([".PNG", "png", "Jpeg", "*", "*"])).toEqual(["png", "jpeg", "*"]);
	});
	it("drops illegal-charset entries and non-strings", () => {
		expect(normalizeExtensions(["p ng", "a/b", "ok", 42, "", "..."])).toEqual(["ok"]);
	});
	it("non-array → []", () => {
		expect(normalizeExtensions("png")).toEqual([]);
		expect(normalizeExtensions(undefined)).toEqual([]);
	});
});

describe("normalizeFilters", () => {
	it("keeps well-formed entries, drops nameless / extension-less ones", () => {
		expect(
			normalizeFilters([
				{ name: "Images", extensions: ["png", ".JPG"] },
				{ name: "", extensions: ["x"] },
				{ name: "NoExt", extensions: [] },
				{ name: "Bad", extensions: ["a b"] },
				"nope",
			]),
		).toEqual([{ name: "Images", extensions: ["png", "jpg"] }]);
	});
	it("non-array → [] (OS shows all files)", () => {
		expect(normalizeFilters(null)).toEqual([]);
	});
});

describe("sanitizeSuggestedName — no path, no traversal", () => {
	it("reduces a hostile path to its bare basename", () => {
		expect(sanitizeSuggestedName("../../.ssh/authorized_keys")).toBe("authorized_keys");
		expect(sanitizeSuggestedName("C:\\evil\\pwn.txt")).toBe("pwn.txt");
		expect(sanitizeSuggestedName("/etc/passwd")).toBe("passwd");
	});
	it("strips control chars, collapses `..`, drops a leading dot", () => {
		expect(sanitizeSuggestedName(`re${CTRL}port.txt`)).toBe("report.txt");
		expect(sanitizeSuggestedName(".hidden")).toBe("hidden");
		expect(sanitizeSuggestedName("a..b")).toBe("a.b");
	});
	it("returns null for empty / path-only / non-string", () => {
		expect(sanitizeSuggestedName("..")).toBeNull();
		expect(sanitizeSuggestedName("/")).toBeNull();
		expect(sanitizeSuggestedName("")).toBeNull();
		expect(sanitizeSuggestedName(42)).toBeNull();
	});
});

describe("normalizeOpenDialog / normalizeSaveDialog", () => {
	it("open: Read mode, multi flag, sanitized filters/title", () => {
		expect(
			normalizeOpenDialog({
				title: `Pick${CTRL} a file`,
				filters: [{ name: "Docs", extensions: ["MD"] }],
				multi: true,
			}),
		).toEqual({
			title: "Pick a file",
			filters: [{ name: "Docs", extensions: ["md"] }],
			multi: true,
			mode: FileHandleMode.Read,
		});
	});
	it("save: ReadWrite mode, sanitized basename, multi never present", () => {
		expect(normalizeSaveDialog({ suggestedName: "../x/Export.json", filters: "bad" })).toEqual({
			title: null,
			filters: [],
			suggestedName: "Export.json",
			mode: FileHandleMode.ReadWrite,
		});
	});
	it("non-object input → safe defaults (never throws)", () => {
		expect(normalizeOpenDialog(undefined)).toEqual({
			title: null,
			filters: [],
			multi: false,
			mode: FileHandleMode.Read,
		});
		expect(normalizeSaveDialog("nope")).toEqual({
			title: null,
			filters: [],
			suggestedName: null,
			mode: FileHandleMode.ReadWrite,
		});
	});
});
