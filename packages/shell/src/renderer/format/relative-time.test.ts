import { afterEach, describe, expect, it } from "vitest";
import { applyLocalePack, getActiveLocale } from "../i18n/t";
import { formatBytes, formatRelative } from "./relative-time";

afterEach(() => {
	// Restore the English base so an override in one test can't leak.
	applyLocalePack("en", {});
});

describe("formatBytes", () => {
	it("collapses zero / negatives / NaN to 0 B", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(-1)).toBe("0 B");
		expect(formatBytes(Number.NaN)).toBe("0 B");
	});

	it("walks the binary unit ladder, ≤1 decimal, no trailing .0", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1024)).toBe("1 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(1024 * 1024)).toBe("1 MB");
		expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe("5 GB");
		expect(formatBytes(2 * 1024 ** 4)).toBe("2 TB");
	});
});

describe("formatRelative", () => {
	const now = 1_700_000_000_000;

	it("buckets into just now / Ns / Nm / Nh / Nd ago", () => {
		expect(formatRelative(now, now - 4_000)).toBe("just now");
		expect(formatRelative(now, now - 30_000)).toBe("30s ago");
		expect(formatRelative(now, now - 5 * 60_000)).toBe("5m ago");
		expect(formatRelative(now, now - 3 * 3_600_000)).toBe("3h ago");
		expect(formatRelative(now, now - 2 * 86_400_000)).toBe("2d ago");
	});

	it("clamps a small future skew to just now (no negative count)", () => {
		expect(formatRelative(now, now + 2_000)).toBe("just now");
	});
});

describe("output is routed through t(), not hardcoded English", () => {
	afterEach(() => applyLocalePack("en", {}));

	it("re-renders the byte unit + relative buckets from the active catalog", () => {
		applyLocalePack("xx", {
			"shell.format.bytes.kb": "{value} kibi",
			"shell.format.justNow": "ahora",
			"shell.format.minutesAgo": "hace {count}m",
		});
		expect(getActiveLocale()).toBe("xx");
		expect(formatBytes(1024)).toBe("1 kibi");
		const now = 1_700_000_000_000;
		expect(formatRelative(now, now - 1_000)).toBe("ahora");
		expect(formatRelative(now, now - 5 * 60_000)).toBe("hace 5m");
	});
});
