/**
 * Pure-logic tests for the diagnostics sink. The filesystem write path is
 * fire-and-forget by design (must never throw into the surface it
 * observes), so the unit surface is the serialiser, the rotation policy,
 * and the cross-Electron-version console-message normaliser.
 */

import { describe, expect, it } from "vitest";
import { LogLevel, formatEntry, normalizeConsoleMessage, shouldRotate } from "./error-log";

describe("formatEntry", () => {
	it("emits one parseable NDJSON line", () => {
		const line = formatEntry({
			ts: "2026-05-16T00:00:00.000Z",
			level: LogLevel.Error,
			scope: "app:io.brainstorm.database",
			message: "boom",
			source: "index.js:1",
		});
		expect(line.endsWith("\n")).toBe(true);
		expect(JSON.parse(line)).toEqual({
			ts: "2026-05-16T00:00:00.000Z",
			level: "error",
			scope: "app:io.brainstorm.database",
			message: "boom",
			source: "index.js:1",
		});
	});
});

describe("shouldRotate", () => {
	it("never rotates an empty file", () => {
		expect(shouldRotate(0, 10_000_000)).toBe(false);
	});
	it("rotates once the file plus the incoming line exceeds the cap", () => {
		expect(shouldRotate(1_999_999, 1)).toBe(false);
		expect(shouldRotate(1_999_999, 2)).toBe(true);
	});
});

describe("normalizeConsoleMessage", () => {
	it("keeps errors and warnings, drops info/log/debug (the noise that hid the signal)", () => {
		// New (Electron ≥35) single-event-object form.
		expect(
			normalizeConsoleMessage([{ level: "error", message: "x", lineNumber: 5, sourceId: "a.js" }]),
		).toEqual({ level: LogLevel.Error, message: "x", source: "a.js:5" });
		expect(normalizeConsoleMessage([{ level: "warning", message: "w", sourceId: "b.js" }])).toEqual({
			level: LogLevel.Warn,
			message: "w",
			source: "b.js",
		});
		expect(normalizeConsoleMessage([{ level: "info", message: "i" }])).toBeNull();
		expect(normalizeConsoleMessage([{ level: "debug", message: "d" }])).toBeNull();
	});

	it("handles the legacy positional signature with numeric levels", () => {
		// (event, level, message, line, sourceId) — 3 = error, 2 = warning.
		expect(normalizeConsoleMessage([{}, 3, "legacy err", 9, "old.js"])).toEqual({
			level: LogLevel.Error,
			message: "legacy err",
			source: "old.js:9",
		});
		expect(normalizeConsoleMessage([{}, 2, "legacy warn", 1, "old.js"])).toEqual({
			level: LogLevel.Warn,
			message: "legacy warn",
			source: "old.js:1",
		});
		expect(normalizeConsoleMessage([{}, 0, "legacy log", 1, "old.js"])).toBeNull();
	});

	it("returns null for an unrecognised shape rather than throwing", () => {
		expect(normalizeConsoleMessage([])).toBeNull();
		expect(normalizeConsoleMessage(["just a string"])).toBeNull();
	});
});
