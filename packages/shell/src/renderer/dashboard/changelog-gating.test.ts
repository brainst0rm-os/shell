import { describe, expect, it } from "vitest";
import { compareVersions as mainCompareVersions } from "../../main/help/changelog";
import type { Changelog, ChangelogRelease } from "../../preload";
import {
	pickPopoverRelease,
	compareVersions as rendererCompareVersions,
	unseenReleaseCount,
} from "./changelog-gating";

function release(version: string): ChangelogRelease {
	return {
		version,
		date: "2026-05-23",
		icon: "🎉",
		title: `Release ${version}`,
		body: [{ kind: "p", text: [{ text: "body" }] }],
	};
}

function changelog(...versions: string[]): Changelog {
	// `pickPopoverRelease` assumes newest-first (the real parser sorts);
	// caller passes versions in that order to keep tests obvious.
	return {
		format: "brainstorm/changelog/v1",
		releases: versions.map(release),
	};
}

describe("compareVersions (renderer mirror)", () => {
	it("matches the main/help mirror exactly on a curated grid", () => {
		// Drift fence — the renderer's helper mirrors the main one. If they
		// diverge, the wrong release surfaces (or none does) in the popover.
		const pairs: [string, string][] = [
			["1.0.0", "1.0.0"],
			["1.0.0", "1.0.1"],
			["1.0.1", "1.0.0"],
			["1.2.0", "1.10.0"],
			["1.10.0", "1.2.0"],
			["1.0", "1.0.0"],
			["1.0.0-rc1", "1.0.0-rc2"],
			["2026.05.23", "2026.05.24"],
			["", "0"],
		];
		for (const [a, b] of pairs) {
			const r = Math.sign(rendererCompareVersions(a, b));
			const m = Math.sign(mainCompareVersions(a, b));
			expect(r, `compareVersions(${a}, ${b})`).toBe(m);
		}
	});
});

describe("pickPopoverRelease", () => {
	it("returns null when the bundled changelog has no releases", () => {
		expect(pickPopoverRelease(changelog(), null)).toBeNull();
		expect(pickPopoverRelease(changelog(), "0.1.0")).toBeNull();
		expect(pickPopoverRelease(changelog(), undefined)).toBeNull();
	});

	it("returns the newest release when lastSeen is null (user has never seen)", () => {
		expect(pickPopoverRelease(changelog("0.3.0", "0.2.0", "0.1.0"), null)?.version).toBe("0.3.0");
	});

	it("treats undefined lastSeen the same as null", () => {
		expect(pickPopoverRelease(changelog("0.3.0", "0.2.0"), undefined)?.version).toBe("0.3.0");
	});

	it("returns null when lastSeen equals the newest", () => {
		expect(pickPopoverRelease(changelog("0.3.0", "0.2.0"), "0.3.0")).toBeNull();
	});

	it("returns null when lastSeen exceeds the newest (downgraded build)", () => {
		// A user on a newer dev build that later runs an older bundle shouldn't
		// see the popover — they've already seen everything in this bundle.
		expect(pickPopoverRelease(changelog("0.3.0", "0.2.0"), "0.99.0")).toBeNull();
	});

	it("returns the newest when lastSeen is strictly older", () => {
		expect(pickPopoverRelease(changelog("0.3.0", "0.2.0", "0.1.0"), "0.1.0")?.version).toBe("0.3.0");
		expect(pickPopoverRelease(changelog("0.3.0", "0.2.0", "0.1.0"), "0.2.0")?.version).toBe("0.3.0");
	});

	it("compares numerically not lexically (1.10.0 > 1.2.0)", () => {
		expect(pickPopoverRelease(changelog("1.10.0"), "1.2.0")?.version).toBe("1.10.0");
		expect(pickPopoverRelease(changelog("1.2.0"), "1.10.0")).toBeNull();
	});
});

describe("unseenReleaseCount", () => {
	it("counts every release when lastSeen is null", () => {
		expect(unseenReleaseCount(changelog("0.3.0", "0.2.0", "0.1.0"), null)).toBe(3);
	});

	it("counts only strictly newer releases", () => {
		expect(unseenReleaseCount(changelog("0.3.0", "0.2.0", "0.1.0"), "0.2.0")).toBe(1);
		expect(unseenReleaseCount(changelog("0.3.0", "0.2.0", "0.1.0"), "0.1.0")).toBe(2);
	});

	it("returns 0 when lastSeen matches the newest", () => {
		expect(unseenReleaseCount(changelog("0.3.0", "0.2.0"), "0.3.0")).toBe(0);
	});

	it("returns 0 for an empty bundle even when lastSeen is null", () => {
		expect(unseenReleaseCount(changelog(), null)).toBe(0);
	});

	it("treats undefined and null lastSeen identically", () => {
		const cl = changelog("0.3.0", "0.2.0");
		expect(unseenReleaseCount(cl, undefined)).toBe(unseenReleaseCount(cl, null));
	});
});
