import { describe, expect, it } from "vitest";
import { formatDuration, formatResolution, shortFormat } from "./media-info";

describe("formatDuration", () => {
	it("formats sub-hour durations as M:SS", () => {
		expect(formatDuration(0)).toBe("0:00");
		expect(formatDuration(5)).toBe("0:05");
		expect(formatDuration(65)).toBe("1:05");
		expect(formatDuration(599)).toBe("9:59");
	});

	it("formats hour+ durations as H:MM:SS", () => {
		expect(formatDuration(3600)).toBe("1:00:00");
		expect(formatDuration(3661)).toBe("1:01:01");
		expect(formatDuration(36_000)).toBe("10:00:00");
	});

	it("floors fractional seconds", () => {
		expect(formatDuration(9.99)).toBe("0:09");
	});

	it("degrades non-finite / negative input to an em dash", () => {
		expect(formatDuration(Number.NaN)).toBe("—");
		expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
		expect(formatDuration(-3)).toBe("—");
	});
});

describe("formatResolution", () => {
	it("renders W × H, rounded", () => {
		expect(formatResolution(1920, 1080)).toBe("1920 × 1080");
		expect(formatResolution(1280.4, 720.6)).toBe("1280 × 721");
	});

	it("returns null for missing / non-positive / non-finite dimensions", () => {
		expect(formatResolution(0, 1080)).toBeNull();
		expect(formatResolution(1920, 0)).toBeNull();
		expect(formatResolution(-1, -1)).toBeNull();
		expect(formatResolution(Number.NaN, 1080)).toBeNull();
	});
});

describe("shortFormat", () => {
	it("uppercases the MIME subtype, dropping any parameters", () => {
		expect(shortFormat("video/mp4")).toBe("MP4");
		expect(shortFormat("audio/x-wav")).toBe("X-WAV");
		expect(shortFormat("audio/mpeg; codecs=mp3")).toBe("MPEG");
	});

	it("falls back to the whole string when there is no slash, empty when blank", () => {
		expect(shortFormat("weird")).toBe("WEIRD");
		expect(shortFormat("")).toBe("");
	});
});
