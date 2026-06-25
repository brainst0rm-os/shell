import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	HELP_CORPUS_FORMAT,
	type HelpArticle,
	HelpTopicKind,
	homeTopicId,
	listSections,
	parseCorpus,
	resolveTopicId,
} from "./help-corpus";

const BUNDLED_PATH = join(__dirname, "..", "..", "..", "help-corpus", "corpus.json");

function article(overrides: Partial<HelpArticle> = {}): HelpArticle {
	const base: HelpArticle = {
		topicId: "guide/getting-started/getting-started/welcome",
		sectionId: "getting-started",
		title: "Welcome to Brainstorm",
		slug: "getting-started/welcome",
		markdown: "# Welcome to Brainstorm\n\nBody.",
		plaintext: "Welcome to Brainstorm Body.",
		headings: [{ depth: 1, text: "Welcome to Brainstorm", anchor: "welcome-to-brainstorm" }],
		relPath: "getting-started/welcome.md",
	};
	return { ...base, ...overrides };
}

describe("parseCorpus", () => {
	it("parses the bundled corpus.json (build-time fence)", () => {
		const raw = JSON.parse(readFileSync(BUNDLED_PATH, "utf8"));
		const corpus = parseCorpus(raw);
		expect(corpus.format).toBe(HELP_CORPUS_FORMAT);
		expect(corpus.articles.length).toBeGreaterThanOrEqual(1);
		for (const a of corpus.articles) {
			expect(a.topicId.length).toBeGreaterThan(0);
			expect(a.title.length).toBeGreaterThan(0);
			expect(a.relPath.endsWith(".md")).toBe(true);
		}
	});

	it("rejects a missing format string", () => {
		expect(() => parseCorpus({ articles: [] })).toThrow(/unsupported format/);
	});

	it("rejects a wrong format string", () => {
		expect(() => parseCorpus({ format: "brainstorm/help-corpus/v0", articles: [] })).toThrow(
			/unsupported format/,
		);
	});

	it("rejects non-object root", () => {
		expect(() => parseCorpus(null)).toThrow(/expected an object/);
		expect(() => parseCorpus("nope")).toThrow(/expected an object/);
		expect(() => parseCorpus([])).toThrow(/unsupported format/);
	});

	it("rejects a non-array articles field", () => {
		expect(() => parseCorpus({ format: HELP_CORPUS_FORMAT, articles: "nope" })).toThrow(
			/articles must be an array/,
		);
	});

	it("rejects an article missing required fields", () => {
		const missing = (key: keyof HelpArticle) => ({
			format: HELP_CORPUS_FORMAT,
			articles: [{ ...article(), [key]: undefined }],
		});
		expect(() => parseCorpus(missing("topicId"))).toThrow();
		expect(() => parseCorpus(missing("sectionId"))).toThrow();
		expect(() => parseCorpus(missing("title"))).toThrow();
		expect(() => parseCorpus(missing("slug"))).toThrow();
		expect(() => parseCorpus(missing("relPath"))).toThrow();
		expect(() => parseCorpus(missing("headings"))).toThrow();
	});

	it("rejects a duplicate topicId across articles", () => {
		expect(() =>
			parseCorpus({
				format: HELP_CORPUS_FORMAT,
				articles: [article(), article()],
			}),
		).toThrow(/duplicate topicId/);
	});

	it("rejects a heading with bad depth", () => {
		expect(() =>
			parseCorpus({
				format: HELP_CORPUS_FORMAT,
				articles: [
					article({
						headings: [{ depth: 9, text: "x", anchor: "x" } as never],
					}),
				],
			}),
		).toThrow(/depth must be 1..6/);
	});

	it("accepts an empty markdown/plaintext (degenerate but legal)", () => {
		const corpus = parseCorpus({
			format: HELP_CORPUS_FORMAT,
			articles: [article({ markdown: "", plaintext: "" })],
		});
		expect(corpus.articles).toHaveLength(1);
		expect(corpus.articles[0]?.markdown).toBe("");
	});
});

describe("resolveTopicId / homeTopicId", () => {
	const CORPUS = parseCorpus({
		format: HELP_CORPUS_FORMAT,
		articles: [
			article({
				topicId: "guide/getting-started/getting-started/welcome",
				sectionId: "getting-started",
				slug: "getting-started/welcome",
			}),
			article({
				topicId: "guide/concepts/vaults",
				sectionId: "concepts",
				slug: "concepts/vaults",
				title: "Vaults",
				relPath: "concepts/vaults.md",
			}),
			article({
				topicId: "app/io.brainstorm.notes/apps/notes",
				sectionId: "app-notes",
				slug: "apps/notes",
				title: "Notes",
				relPath: "apps/notes.md",
			}),
			article({
				topicId: "guide/settings/data",
				sectionId: "concepts",
				slug: "settings/data",
				title: "Data",
				relPath: "concepts/properties.md",
			}),
		],
	});

	it("returns the home topic for `dashboard`", () => {
		expect(resolveTopicId(CORPUS, "dashboard")).toBe("guide/getting-started/getting-started/welcome");
	});

	it("returns the matching app topic for `app/<appId>`", () => {
		expect(resolveTopicId(CORPUS, "app/io.brainstorm.notes")).toBe(
			"app/io.brainstorm.notes/apps/notes",
		);
	});

	it("falls back to home for unknown app id", () => {
		expect(resolveTopicId(CORPUS, "app/io.brainstorm.unknown")).toBe(
			"guide/getting-started/getting-started/welcome",
		);
	});

	it("matches an exact guide route", () => {
		expect(resolveTopicId(CORPUS, "guide/concepts/vaults")).toBe("guide/concepts/vaults");
	});

	it("resolves a `settings/<pane>` route to its guide article", () => {
		expect(resolveTopicId(CORPUS, "settings/data")).toBe("guide/settings/data");
	});

	it("falls back to home for unknown `settings/<pane>`", () => {
		expect(resolveTopicId(CORPUS, "settings/nope")).toBe(
			"guide/getting-started/getting-started/welcome",
		);
	});

	it("returns null for unrecognised route prefixes", () => {
		expect(resolveTopicId(CORPUS, "something/weird")).toBeNull();
		expect(resolveTopicId(CORPUS, "")).toBeNull();
	});

	it("homeTopicId returns null for an empty corpus", () => {
		const empty = parseCorpus({ format: HELP_CORPUS_FORMAT, articles: [] });
		expect(homeTopicId(empty)).toBeNull();
		expect(resolveTopicId(empty, "dashboard")).toBeNull();
	});

	it("resolves a `section/<id>` route to that section's first article", () => {
		expect(resolveTopicId(CORPUS, "section/app-notes")).toBe("app/io.brainstorm.notes/apps/notes");
	});

	it("falls back to home for unknown sections", () => {
		expect(resolveTopicId(CORPUS, "section/nope")).toBe(
			"guide/getting-started/getting-started/welcome",
		);
	});
});

describe("listSections", () => {
	it("returns sections in declaration order with first-article topicIds and labels", () => {
		const corpus = parseCorpus({
			format: HELP_CORPUS_FORMAT,
			sections: [
				{
					id: "getting-started",
					titleKey: "shell.help.section.gettingStarted",
					title: "Getting started",
					kind: HelpTopicKind.GettingStarted,
				},
				{
					id: "concepts",
					titleKey: "shell.help.section.concepts",
					title: "Concepts",
					kind: HelpTopicKind.Guide,
				},
			],
			articles: [
				article({
					topicId: "guide/getting-started/getting-started/welcome",
					sectionId: "getting-started",
					slug: "getting-started/welcome",
				}),
				article({
					topicId: "guide/concepts/vaults",
					sectionId: "concepts",
					slug: "concepts/vaults",
					title: "Vaults",
					relPath: "concepts/vaults.md",
				}),
			],
		});
		const sections = listSections(corpus);
		expect(sections).toEqual([
			{
				sectionId: "getting-started",
				firstTopicId: "guide/getting-started/getting-started/welcome",
				label: "Getting started",
			},
			{ sectionId: "concepts", firstTopicId: "guide/concepts/vaults", label: "Concepts" },
		]);
	});

	it("falls back to sectionId when no matching section metadata", () => {
		const corpus = parseCorpus({
			format: HELP_CORPUS_FORMAT,
			articles: [article({ sectionId: "orphan" })],
		});
		const sections = listSections(corpus);
		expect(sections).toEqual([
			{
				sectionId: "orphan",
				firstTopicId: "guide/getting-started/getting-started/welcome",
				label: "orphan",
			},
		]);
	});
});
