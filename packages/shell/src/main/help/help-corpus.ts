/**
 * Help-1 — typed parser for the build-time-bundled help corpus.
 *
 * Mirrors the `parseChangelog` (Feedback-3) posture: fail-loud on any
 * shape violation because the input is a build artifact emitted by
 * `packages/shell/scripts/build-help-corpus.mjs`. A parse failure at
 * runtime indicates the build pipeline shipped a broken corpus — that
 * is release-blocking, not a runtime user-facing condition.
 *
 * The shape is intentionally a degenerate `DocsPack/v1` — DocsHub-1
 * (post-v1) swaps the substrate to the signed/versioned pack format
 * without changing this interface.
 */

export const HELP_CORPUS_FORMAT = "brainstorm/help-corpus/v1";

export enum HelpTopicKind {
	GettingStarted = "getting-started",
	Guide = "guide",
	App = "app",
}

export type HelpHeading = {
	readonly depth: number;
	readonly text: string;
	readonly anchor: string;
};

export type HelpArticle = {
	readonly topicId: string;
	readonly sectionId: string;
	readonly title: string;
	readonly slug: string;
	readonly markdown: string;
	readonly plaintext: string;
	readonly headings: readonly HelpHeading[];
	readonly relPath: string;
};

export type HelpSection = {
	readonly id: string;
	readonly titleKey: string;
	readonly title: string;
	readonly kind: HelpTopicKind;
	readonly appId?: string;
};

export type HelpCorpus = {
	readonly format: typeof HELP_CORPUS_FORMAT;
	readonly sections: readonly HelpSection[];
	readonly articles: readonly HelpArticle[];
};

export type HelpHit = {
	readonly topicId: string;
	readonly sectionId: string;
	readonly title: string;
	readonly snippet: string;
	readonly score: number;
};

export function parseCorpus(raw: unknown): HelpCorpus {
	if (!raw || typeof raw !== "object") {
		throw new Error("help-corpus: expected an object");
	}
	const root = raw as { format?: unknown; articles?: unknown; sections?: unknown };
	if (root.format !== HELP_CORPUS_FORMAT) {
		throw new Error(
			`help-corpus: unsupported format ${JSON.stringify(root.format)} (expected ${HELP_CORPUS_FORMAT})`,
		);
	}
	if (!Array.isArray(root.articles)) {
		throw new Error("help-corpus: articles must be an array");
	}
	const seen = new Set<string>();
	const articles = root.articles.map((a, i) => {
		const article = parseArticle(a, i);
		if (seen.has(article.topicId)) {
			throw new Error(`help-corpus: duplicate topicId ${article.topicId}`);
		}
		seen.add(article.topicId);
		return article;
	});
	const sections = Array.isArray(root.sections)
		? root.sections.map((s, i) => parseSection(s, i))
		: [];
	return { format: HELP_CORPUS_FORMAT as typeof HELP_CORPUS_FORMAT, sections, articles };
}

function parseSection(raw: unknown, index: number): HelpSection {
	if (!raw || typeof raw !== "object") {
		throw new Error(`help-corpus: section ${index} must be an object`);
	}
	const s = raw as Record<string, unknown>;
	const id = asNonEmptyString(s.id, `section ${index} id`);
	const titleKey = asNonEmptyString(s.titleKey, `section ${index} titleKey`);
	const title = asNonEmptyString(s.title, `section ${index} title`);
	const kindRaw = asNonEmptyString(s.kind, `section ${index} kind`);
	const kind = kindRaw as HelpTopicKind;
	const out: HelpSection = { id, titleKey, title, kind };
	if (typeof s.appId === "string" && s.appId.length > 0) {
		return { ...out, appId: s.appId };
	}
	return out;
}

function parseArticle(raw: unknown, index: number): HelpArticle {
	if (!raw || typeof raw !== "object") {
		throw new Error(`help-corpus: article ${index} must be an object`);
	}
	const a = raw as Record<string, unknown>;
	const topicId = asNonEmptyString(a.topicId, `article ${index} topicId`);
	const sectionId = asNonEmptyString(a.sectionId, `article ${index} sectionId`);
	const title = asNonEmptyString(a.title, `article ${index} title`);
	const slug = asNonEmptyString(a.slug, `article ${index} slug`);
	const markdown = asString(a.markdown, `article ${index} markdown`);
	const plaintext = asString(a.plaintext, `article ${index} plaintext`);
	const relPath = asNonEmptyString(a.relPath, `article ${index} relPath`);
	if (!Array.isArray(a.headings)) {
		throw new Error(`help-corpus: article ${index} headings must be an array`);
	}
	const headings = a.headings.map((h, hi) => parseHeading(h, index, hi));
	return { topicId, sectionId, title, slug, markdown, plaintext, headings, relPath };
}

function parseHeading(raw: unknown, articleIndex: number, headingIndex: number): HelpHeading {
	if (!raw || typeof raw !== "object") {
		throw new Error(`help-corpus: article ${articleIndex} heading ${headingIndex} must be an object`);
	}
	const h = raw as Record<string, unknown>;
	const depth = h.depth;
	if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 1 || depth > 6) {
		throw new Error(
			`help-corpus: article ${articleIndex} heading ${headingIndex} depth must be 1..6`,
		);
	}
	const text = asNonEmptyString(h.text, `article ${articleIndex} heading ${headingIndex} text`);
	const anchor = asString(h.anchor, `article ${articleIndex} heading ${headingIndex} anchor`);
	return { depth, text, anchor };
}

function asNonEmptyString(raw: unknown, label: string): string {
	if (typeof raw !== "string" || raw.length === 0) {
		throw new Error(`help-corpus: ${label} must be a non-empty string`);
	}
	return raw;
}

function asString(raw: unknown, label: string): string {
	if (typeof raw !== "string") {
		throw new Error(`help-corpus: ${label} must be a string`);
	}
	return raw;
}

/** Translate a stable in-app route ("dashboard", "settings/data",
 *  "app/io.brainstorm.notes", "section/<sectionId>") into the topicId
 *  the corpus addresses the matching article by. Returns null when the
 *  route has no curated article — Help-2's caller falls back to the home
 *  topic.
 *
 *  Grammar (kept full for forward-compat with Help-2; Help-1 only uses
 *  the home fallback):
 *
 *    "dashboard"              → first guide article
 *    "settings/<pane>"        → "guide/settings/<pane>" or guide fallback
 *    "app/<appId>"            → first article in section app-<appId>
 *    "app/<appId>/<slug>"     → exact match by topicId
 *    "guide/<slug>"           → exact match by topicId
 *    "section/<sectionId>"    → first article in that section
 *
 *  The route is purely advisory; the resolver never throws — an unknown
 *  route returns null so the caller can route to home. */
export function resolveTopicId(corpus: HelpCorpus, route: string): string | null {
	if (typeof route !== "string" || route.length === 0) return null;
	const articles = corpus.articles;
	if (articles.length === 0) return null;

	const exact = articles.find((a) => a.topicId === route);
	if (exact) return exact.topicId;

	if (route === "dashboard") {
		return homeTopicId(corpus);
	}

	if (route.startsWith("section/")) {
		const sectionId = route.slice("section/".length);
		const sectionMatch = articles.find((a) => a.sectionId === sectionId);
		if (sectionMatch) return sectionMatch.topicId;
		return homeTopicId(corpus);
	}

	if (route.startsWith("app/")) {
		const rest = route.slice("app/".length);
		const slashIndex = rest.indexOf("/");
		const appId = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
		const sectionMatch = articles.find(
			(a) => a.sectionId === `app-${shortAppId(appId)}` || a.sectionId === `app-${appId}`,
		);
		if (sectionMatch) return sectionMatch.topicId;
		return homeTopicId(corpus);
	}

	if (route.startsWith("settings/")) {
		const candidate = `guide/${route}`;
		const found = articles.find((a) => a.topicId === candidate);
		if (found) return found.topicId;
		return homeTopicId(corpus);
	}

	if (route.startsWith("guide/")) {
		const found = articles.find((a) => a.topicId === route);
		if (found) return found.topicId;
		return homeTopicId(corpus);
	}

	return null;
}

/** Enumerate the sections present in the corpus in declaration order,
 *  each paired with the first article's topicId + the section's English
 *  label. Used by the menu composer to build the Help submenu. */
export function listSections(
	corpus: HelpCorpus,
): readonly { sectionId: string; firstTopicId: string; label: string }[] {
	const order: string[] = [];
	const firstByid = new Map<string, string>();
	for (const a of corpus.articles) {
		if (!firstByid.has(a.sectionId)) {
			order.push(a.sectionId);
			firstByid.set(a.sectionId, a.topicId);
		}
	}
	const labelById = new Map(corpus.sections.map((s) => [s.id, s.title]));
	return order.map((sectionId) => ({
		sectionId,
		firstTopicId: firstByid.get(sectionId) ?? "",
		label: labelById.get(sectionId) ?? sectionId,
	}));
}

/** First article's topicId — the Help home fallback. */
export function homeTopicId(corpus: HelpCorpus): string | null {
	const first = corpus.articles[0];
	return first ? first.topicId : null;
}

function shortAppId(appId: string): string {
	const dot = appId.lastIndexOf(".");
	return dot === -1 ? appId : appId.slice(dot + 1);
}
