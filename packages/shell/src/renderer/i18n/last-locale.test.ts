// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readLastLocale, rememberLastLocale } from "./last-locale";

afterEach(() => {
	window.localStorage.clear();
	vi.restoreAllMocks();
});

describe("last-locale (12.15 15e)", () => {
	it("returns the source language when nothing is stored", () => {
		expect(readLastLocale()).toBe("en");
	});

	it("round-trips the remembered language", () => {
		rememberLastLocale("de-AT");
		expect(readLastLocale()).toBe("de-AT");
	});

	it("ignores an empty / whitespace remembered value", () => {
		rememberLastLocale("   ");
		expect(window.localStorage.getItem("brainstorm.locale.last")).toBeNull();
		expect(readLastLocale()).toBe("en");
	});

	it("falls back to the source language for a blank stored value", () => {
		window.localStorage.setItem("brainstorm.locale.last", "  ");
		expect(readLastLocale()).toBe("en");
	});

	it("tolerates storage that throws on read", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		expect(readLastLocale()).toBe("en");
	});

	it("tolerates storage that throws on write", () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("quota");
		});
		expect(() => rememberLastLocale("es")).not.toThrow();
	});
});
