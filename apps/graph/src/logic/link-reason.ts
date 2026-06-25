/**
 * `link-reason` — the single place that turns a wire `linkType` (+ optional
 * `detail`) into the human answer to "why are these two objects connected?".
 *
 * Every graph edge carries a semantic `linkType` (the entities service stamps
 * it: a body mention, a property reference, a shared attribute) plus, for the
 * derived kinds, a `detail` string (the shared value, or the source property
 * name). The renderer used to discard both and draw bare geometry; this module
 * classifies the link into one of three categories and produces localized
 * labels for the edge tooltip, the node hover breakdown, and the legend.
 *
 * Pure + deterministic: `linkType`/`detail` in → label out. The wire strings
 * are protocol constants (mirrored from the shell's `note-entities-codec` /
 * `link-types` / `derive-*-links`); they arrive as data, so we match on them
 * here rather than importing across the app/shell boundary.
 */

import { t } from "../i18n/t";

/** The three reasons an edge can exist. Drives both the label and the
 *  per-category edge colour. */
export enum LinkCategory {
	/** Authored in an editor body — a mention or link/embed/transclusion. */
	BodyLink = "body",
	/** A property on the source points at the destination entity. */
	PropertyReference = "reference",
	/** Source and destination share the same value of a grouping property. */
	SharedAttribute = "shared",
}

// ─── Wire-format linkType prefixes / constants ────────────────────────────────

const NOTE_LINK_PREFIX = "io.brainstorm.notes/";
const SHARED_PROPERTY_PREFIX = "brainstorm/shared-property/";

const NOTE_MENTION = "io.brainstorm.notes/mention";
const NOTE_REFERENCE = "io.brainstorm.notes/link";

/** Structured first-party + property-ref link types that get a curated verb
 *  rather than a property-name fallback. Keyed by exact wire string. */
const STRUCTURED_LABEL_KEYS: Readonly<
	Record<
		string,
		| "reason.contains"
		| "reason.about"
		| "reason.fromMilestone"
		| "reason.fromIteration"
		| "reason.inProject"
		| "reason.inStage"
		| "reason.resolves"
		| "reason.inRelease"
		| "reason.gatedBy"
	>
> = {
	"brainstorm/Folder/contains": "reason.contains",
	"brainstorm/Note/about": "reason.about",
	"brainstorm/Event/from-milestone": "reason.fromMilestone",
	"brainstorm/Task/from-iteration": "reason.fromIteration",
	"brainstorm/Task/in-project": "reason.inProject",
	"brainstorm/Iteration/in-stage": "reason.inStage",
	"brainstorm/Iteration/resolves-oq": "reason.resolves",
	"brainstorm/Stage/in-release": "reason.inRelease",
	"brainstorm/Milestone/in-release": "reason.inRelease",
	"brainstorm/Stage/gated-by": "reason.gatedBy",
};

/** Humanized attribute noun per known shared-property field, so "Shares tag"
 *  reads naturally instead of "Shares tags". Unknown fields fall back to the
 *  raw `<prop>` suffix. */
const SHARED_ATTR_NOUNS: Readonly<Record<string, string>> = {
	tags: "tag",
	category: "category",
	section: "section",
	ownerDomain: "domain",
	company: "company",
};

/** Minimal shape this module reads — a subset of `LinkRow`. */
export type ReasonLink = {
	linkType: string;
	detail?: string;
};

/** Whether an edge is directed (reference / body link, source → dest) or
 *  undirected (a shared attribute is symmetric). */
export function isDirectedCategory(category: LinkCategory): boolean {
	return category !== LinkCategory.SharedAttribute;
}

/** Classify a `linkType` into its reason category. */
export function linkCategory(linkType: string): LinkCategory {
	if (linkType.startsWith(SHARED_PROPERTY_PREFIX)) return LinkCategory.SharedAttribute;
	if (linkType.startsWith(NOTE_LINK_PREFIX)) return LinkCategory.BodyLink;
	return LinkCategory.PropertyReference;
}

/** The shared-attribute field noun parsed from a `…/<Type>.<prop>` linkType
 *  (e.g. `Person.company` → "company"), humanized where known. */
function sharedAttrNoun(linkType: string): string {
	const tail = linkType.slice(SHARED_PROPERTY_PREFIX.length);
	const dot = tail.lastIndexOf(".");
	const prop = dot === -1 ? tail : tail.slice(dot + 1);
	return SHARED_ATTR_NOUNS[prop] ?? prop;
}

/** Title-case a hyphenated wire suffix as a last-ditch readable label
 *  (`in-project` → "In project"). */
function humanizeSuffix(linkType: string): string {
	const slash = linkType.lastIndexOf("/");
	const suffix = (slash === -1 ? linkType : linkType.slice(slash + 1)).replace(/-/g, " ");
	if (suffix.length === 0) return linkType;
	return suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

/**
 * Grouping label for the node hover breakdown — stable across edges of the
 * same kind, so it does NOT include the per-edge `detail` value. ("Mentions",
 * "In project", "Shares company".)
 */
export function linkReasonShortLabel(linkType: string): string {
	if (linkType === NOTE_MENTION) return t("reason.mentions");
	if (linkType === NOTE_REFERENCE) return t("reason.linksTo");
	const structured = STRUCTURED_LABEL_KEYS[linkType];
	if (structured) return t(structured);
	if (linkType.startsWith(SHARED_PROPERTY_PREFIX)) {
		return t("reason.shares", { attr: sharedAttrNoun(linkType) });
	}
	// Generic property reference: prefer the humanized last segment.
	return humanizeSuffix(linkType);
}

/**
 * Full label for the edge tooltip — includes the per-edge `detail` value when
 * present. ("Shares company: Acme", "Assignee", "Mentions".)
 */
export function linkReasonLabel(link: ReasonLink): string {
	const { linkType, detail } = link;
	if (linkType.startsWith(SHARED_PROPERTY_PREFIX)) {
		const attr = sharedAttrNoun(linkType);
		return detail && detail.length > 0
			? t("reason.sharesValue", { attr, value: detail })
			: t("reason.shares", { attr });
	}
	if (linkType === NOTE_MENTION) return t("reason.mentions");
	if (linkType === NOTE_REFERENCE) return t("reason.linksTo");
	const structured = STRUCTURED_LABEL_KEYS[linkType];
	if (structured) return t(structured);
	// Generic property reference: the source property name is the best label.
	if (detail && detail.length > 0) return detail;
	return humanizeSuffix(linkType);
}

/** Localized legend name for a category. */
export function linkCategoryLabel(category: LinkCategory): string {
	switch (category) {
		case LinkCategory.BodyLink:
			return t("reason.categoryBody");
		case LinkCategory.PropertyReference:
			return t("reason.categoryReference");
		case LinkCategory.SharedAttribute:
			return t("reason.categoryShared");
	}
}
