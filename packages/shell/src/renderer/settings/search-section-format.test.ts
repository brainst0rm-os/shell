import { describe, expect, it } from "vitest";
import {
	coveragePercent,
	formatBytes,
	formatRelativeTime,
	shortTypeName,
} from "./search-section-format";

describe("coveragePercent", () => {
	it("returns null when the source count is unknown", () => {
		expect(coveragePercent(10, null)).toBeNull();
	});

	it("is 100% when there is nothing indexable (empty or stale-extra index)", () => {
		expect(coveragePercent(0, 0)).toBe(100);
		expect(coveragePercent(5, 0)).toBe(100);
	});

	it("rounds the ratio and clamps to 0–100", () => {
		expect(coveragePercent(50, 100)).toBe(50);
		expect(coveragePercent(1, 3)).toBe(33);
		expect(coveragePercent(2, 3)).toBe(67);
		// Index ahead of the source scan (lag) → clamp, never >100.
		expect(coveragePercent(120, 100)).toBe(100);
		expect(coveragePercent(0, 100)).toBe(0);
	});
});

describe("formatBytes", () => {
	it("collapses zero / garbage to 0 B", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(-1)).toBe("0 B");
		expect(formatBytes(Number.NaN)).toBe("0 B");
	});

	it("uses binary units with ≤1 decimal", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1024)).toBe("1 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1024 * 1024)).toBe("1 MB");
		expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
	});
});

describe("formatRelativeTime", () => {
	const now = 1_000_000_000_000;

	it("returns null for absent / zero / future timestamps", () => {
		expect(formatRelativeTime(0, now)).toBeNull();
		expect(formatRelativeTime(-5, now)).toBeNull();
		expect(formatRelativeTime(now + 5000, now)).toBeNull();
	});

	it("bucketises into just now / m / h / d", () => {
		expect(formatRelativeTime(now - 5_000, now)).toBe("just now");
		expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5m ago");
		expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
		expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
	});
});

describe("shortTypeName", () => {
	it("extracts the Type segment from an app type URI", () => {
		expect(shortTypeName("io.brainstorm.notes/Note/v1")).toBe("Note");
		expect(shortTypeName("io.brainstorm.tasks/Task/v1")).toBe("Task");
	});

	it("falls back to the raw value when the shape doesn't match", () => {
		expect(shortTypeName("Note")).toBe("Note");
		expect(shortTypeName("")).toBe("");
		expect(shortTypeName("a/b")).toBe("a");
	});
});
