import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	CHANGELOG_FORMAT,
	type ChangelogBlock,
	ChangelogBlockKind,
	type ChangelogRelease,
	TextMark,
	compareVersions,
	parseChangelog,
	unseenReleases,
} from "./changelog";

const BUNDLED_PATH = join(__dirname, "..", "..", "..", "changelog", "changelog.json");

/** Build a valid minimal release in v2 shape. Tests that want to assert
 *  a specific failure override individual fields via `Partial`. */
function release(overrides: Partial<ChangelogRelease> = {}): ChangelogRelease {
	const base: ChangelogRelease = {
		version: "0.0.1",
		date: "2026-05-23",
		icon: "🎉",
		title: "Release",
		body: [{ kind: ChangelogBlockKind.Paragraph, text: [{ text: "n" }] }],
	};
	return { ...base, ...overrides };
}

describe("parseChangelog", () => {
	it("parses the bundled changelog.json (build-time fence)", () => {
		// The bundled file is what the IPC handler serves. A typo in the
		// repo'd file = an empty Settings → What's new on launch — fail
		// the build instead.
		const raw = JSON.parse(readFileSync(BUNDLED_PATH, "utf8"));
		const cl = parseChangelog(raw);
		expect(cl.format).toBe(CHANGELOG_FORMAT);
		expect(cl.releases.length).toBeGreaterThanOrEqual(1);
		for (const r of cl.releases) {
			expect(r.body.length).toBeGreaterThan(0);
			expect(r.icon.length).toBeGreaterThan(0);
		}
	});

	it("rejects a missing format string", () => {
		expect(() => parseChangelog({ releases: [] })).toThrow(/unsupported format/);
	});

	it("rejects a wrong format string (drops v1 callers loudly)", () => {
		expect(() => parseChangelog({ format: "brainstorm/changelog/v1", releases: [] })).toThrow(
			/unsupported format/,
		);
	});

	it("rejects non-object root", () => {
		expect(() => parseChangelog(null)).toThrow(/expected an object/);
		expect(() => parseChangelog([])).toThrow(/unsupported format/);
		expect(() => parseChangelog("not-an-object")).toThrow(/expected an object/);
	});

	it("rejects a non-array releases field", () => {
		expect(() => parseChangelog({ format: CHANGELOG_FORMAT, releases: "nope" })).toThrow(
			/releases must be an array/,
		);
	});

	it("rejects a release missing required fields", () => {
		const missing = (key: keyof ChangelogRelease) => ({
			format: CHANGELOG_FORMAT,
			releases: [{ ...release(), [key]: undefined }],
		});
		expect(() => parseChangelog(missing("version"))).toThrow();
		expect(() => parseChangelog(missing("date"))).toThrow();
		expect(() => parseChangelog(missing("title"))).toThrow();
		expect(() => parseChangelog(missing("icon"))).toThrow();
		expect(() => parseChangelog(missing("body"))).toThrow();
	});

	it("rejects a non-ISO date", () => {
		expect(() =>
			parseChangelog({
				format: CHANGELOG_FORMAT,
				releases: [release({ date: "May 23 2026" })],
			}),
		).toThrow(/ISO YYYY-MM-DD/);
	});

	it("rejects an empty body", () => {
		expect(() =>
			parseChangelog({ format: CHANGELOG_FORMAT, releases: [release({ body: [] })] }),
		).toThrow(/at least one block/);
	});

	it("rejects an unknown block kind", () => {
		expect(() =>
			parseChangelog({
				format: CHANGELOG_FORMAT,
				releases: [
					release({
						body: [{ kind: "h7", text: "nope" } as unknown as ChangelogBlock],
					}),
				],
			}),
		).toThrow(/must be one of/);
	});

	it("requires a callout to carry a non-empty icon", () => {
		expect(() =>
			parseChangelog({
				format: CHANGELOG_FORMAT,
				releases: [
					release({
						body: [
							{
								kind: ChangelogBlockKind.Callout,
								text: [{ text: "x" }],
							} as unknown as ChangelogBlock,
						],
					}),
				],
			}),
		).toThrow(/callout.*icon.*non-empty/);
	});

	it("rejects an empty paragraph text run", () => {
		expect(() =>
			parseChangelog({
				format: CHANGELOG_FORMAT,
				releases: [
					release({
						body: [
							{
								kind: ChangelogBlockKind.Paragraph,
								text: [{ text: "" }],
							},
						],
					}),
				],
			}),
		).toThrow(/non-empty string/);
	});

	it("accepts a string text shorthand and normalises it to a single run", () => {
		const cl = parseChangelog({
			format: CHANGELOG_FORMAT,
			releases: [
				release({
					body: [
						{
							kind: ChangelogBlockKind.Paragraph,
							text: "shorthand" as unknown as readonly { text: string }[],
						},
					],
				}),
			],
		});
		const block = cl.releases[0]?.body[0];
		expect(block?.kind).toBe(ChangelogBlockKind.Paragraph);
		if (block?.kind === ChangelogBlockKind.Paragraph) {
			expect(block.text).toEqual([{ text: "shorthand" }]);
		}
	});

	it("rejects an unknown text-run mark", () => {
		expect(() =>
			parseChangelog({
				format: CHANGELOG_FORMAT,
				releases: [
					release({
						body: [
							{
								kind: ChangelogBlockKind.Paragraph,
								text: [{ text: "x", marks: ["italic" as TextMark] }],
							},
						],
					}),
				],
			}),
		).toThrow(/must be one of/);
	});

	it("rejects a duplicated mark on a single run", () => {
		expect(() =>
			parseChangelog({
				format: CHANGELOG_FORMAT,
				releases: [
					release({
						body: [
							{
								kind: ChangelogBlockKind.Paragraph,
								text: [{ text: "x", marks: [TextMark.Bold, TextMark.Bold] }],
							},
						],
					}),
				],
			}),
		).toThrow(/duplicated/);
	});

	it("accepts a richly-marked run round-trip", () => {
		const cl = parseChangelog({
			format: CHANGELOG_FORMAT,
			releases: [
				release({
					body: [
						{
							kind: ChangelogBlockKind.Paragraph,
							text: [
								{ text: "Open " },
								{ text: "⌘+K", marks: [TextMark.Highlight] },
								{ text: " to search; " },
								{ text: "Settings", marks: [TextMark.Bold] },
							],
						},
					],
				}),
			],
		});
		const block = cl.releases[0]?.body[0];
		if (block?.kind === ChangelogBlockKind.Paragraph) {
			expect(block.text).toHaveLength(4);
			expect(block.text[1]).toEqual({ text: "⌘+K", marks: [TextMark.Highlight] });
		}
	});

	it("preserves the optional summary when present and omits the key when missing", () => {
		const withSummary = parseChangelog({
			format: CHANGELOG_FORMAT,
			releases: [release({ summary: "Pre-alpha." })],
		});
		expect(withSummary.releases[0]?.summary).toBe("Pre-alpha.");
		const withoutSummary = parseChangelog({
			format: CHANGELOG_FORMAT,
			releases: [release()],
		});
		expect(withoutSummary.releases[0]?.summary).toBeUndefined();
	});

	it("re-sorts releases newest-first regardless of bundled order", () => {
		const cl = parseChangelog({
			format: CHANGELOG_FORMAT,
			releases: [
				release({ version: "0.0.1", title: "older" }),
				release({ version: "1.2.0", title: "newer" }),
				release({ version: "1.10.0", title: "newest" }),
			],
		});
		expect(cl.releases.map((r) => r.version)).toEqual(["1.10.0", "1.2.0", "0.0.1"]);
	});
});

describe("compareVersions", () => {
	it("compares dotted-numeric segments numerically (1.10 > 1.2)", () => {
		expect(compareVersions("1.10.0", "1.2.0")).toBeGreaterThan(0);
		expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
	});

	it("equal versions compare to 0", () => {
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
		expect(compareVersions("", "")).toBe(0);
	});

	it("missing segments treated as 0 (1.2 == 1.2.0)", () => {
		expect(compareVersions("1.2", "1.2.0")).toBe(0);
		expect(compareVersions("1", "1.0.0")).toBe(0);
	});

	it("falls back to lexicographic on non-numeric segments", () => {
		expect(compareVersions("1.0-rc1", "1.0-rc2")).toBeLessThan(0);
		expect(compareVersions("1.0-rc1", "1.0")).toBeGreaterThan(0);
	});
});

describe("unseenReleases", () => {
	const FIXTURE = parseChangelog({
		format: CHANGELOG_FORMAT,
		releases: [
			release({ version: "0.0.1", title: "v0" }),
			release({ version: "0.1.0", title: "v0.1" }),
			release({ version: "0.2.0", title: "v0.2" }),
		],
	});

	it("returns every release when lastSeenVersion is null (first-launch)", () => {
		expect(unseenReleases(FIXTURE, null)).toHaveLength(3);
	});

	it("returns only releases strictly newer than lastSeenVersion", () => {
		const unseen = unseenReleases(FIXTURE, "0.1.0");
		expect(unseen.map((r) => r.version)).toEqual(["0.2.0"]);
	});

	it("returns [] when lastSeenVersion is at or above the latest release", () => {
		expect(unseenReleases(FIXTURE, "0.2.0")).toEqual([]);
		expect(unseenReleases(FIXTURE, "9.9.9")).toEqual([]);
	});

	it("returns every release when lastSeenVersion is older than the oldest", () => {
		const unseen = unseenReleases(FIXTURE, "0.0.0");
		expect(unseen).toHaveLength(3);
	});
});
