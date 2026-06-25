/**
 * Content-kind registry foundation per docs/apps/47-marketplace.md
 * §The content-kind registry.
 *
 * The shell stores every installable piece of content under a `ContentKind`
 * discriminator. Apps and themes are the v1 kinds — apps run code under a
 * capability surface; themes are passive data (token sets + icon packs +
 * typography).
 *
 * v2 adds Plugin / LayoutPack / WallpaperPack / LocalePack / WorkflowPack /
 * ShortcutPack via the same descriptor contract — see 47-marketplace.md
 * §Per-kind properties at a glance.
 *
 * This file ships the **enum + descriptor metadata** only. Renderer-side
 * components for store cards / detail pages live next to the renderer
 * surface in `renderer/marketplace/`; the descriptor metadata routes
 * through them by `ContentKind`, not by direct reference.
 */

export enum ContentKind {
	App = "app",
	Theme = "theme",
}

export enum ThreatProfile {
	/** Executes JS in a sandboxed renderer. Reviewed behaviorally. */
	ActiveCode = "active-code",
	/** Bundle is passive (SVGs, JSON). Reviewed via static lint. */
	PassiveData = "passive-data",
	/** Metadata only (a few JSON fields). Reviewed for shape. */
	MetadataOnly = "metadata-only",
}

export enum ReviewModel {
	Behavioral = "behavioral",
	StaticOnly = "static-only",
	MetadataOnly = "metadata-only",
}

export enum SignaturePolicy {
	/** v2 mandatory for catalog listing. */
	Mandatory = "mandatory",
	/** v1 default — sideload allowed unsigned with warning. */
	SoftEncouraged = "soft-encouraged",
	/** v2 passive-data kinds may opt-in to signature, not required. */
	Optional = "optional",
}

/**
 * Static descriptor for a content kind. The marketplace shell surface uses
 * these to decide listing chrome (badge label, threat info), and the
 * service uses them to dispatch validate / install / uninstall / update
 * to the right concrete pipeline.
 *
 * Per 47-marketplace.md the descriptor also surfaces renderer components
 * (storeCard / detailPage / manageRow). We split those into the renderer
 * package (`renderer/marketplace/kind-views.ts`) so the main process stays
 * UI-free.
 */
export type ContentKindDescriptor = {
	kind: ContentKind;
	/** i18n key — never bare text per docs/35 §Localization. */
	labelKey: string;
	/** i18n key for a 1-sentence description shown in store filters. */
	descriptionKey: string;
	threatProfile: ThreatProfile;
	reviewModel: ReviewModel;
	/** v1 posture; v2 tightens (see 47-marketplace.md §Phasing). */
	signaturePolicy: SignaturePolicy;
	/** Listing default — what the user sees pre-install. */
	capabilitySurface: "manifest-declared" | "none";
};

export const APP_DESCRIPTOR: ContentKindDescriptor = {
	kind: ContentKind.App,
	labelKey: "shell.marketplace.kind.app.label",
	descriptionKey: "shell.marketplace.kind.app.description",
	threatProfile: ThreatProfile.ActiveCode,
	reviewModel: ReviewModel.Behavioral,
	signaturePolicy: SignaturePolicy.SoftEncouraged,
	capabilitySurface: "manifest-declared",
};

export const THEME_DESCRIPTOR: ContentKindDescriptor = {
	kind: ContentKind.Theme,
	labelKey: "shell.marketplace.kind.theme.label",
	descriptionKey: "shell.marketplace.kind.theme.description",
	threatProfile: ThreatProfile.PassiveData,
	reviewModel: ReviewModel.StaticOnly,
	signaturePolicy: SignaturePolicy.SoftEncouraged,
	capabilitySurface: "none",
};

const DESCRIPTORS: Record<ContentKind, ContentKindDescriptor> = {
	[ContentKind.App]: APP_DESCRIPTOR,
	[ContentKind.Theme]: THEME_DESCRIPTOR,
};

export function descriptorFor(kind: ContentKind): ContentKindDescriptor {
	return DESCRIPTORS[kind];
}

export const ALL_KINDS: readonly ContentKind[] = Object.values(ContentKind);

export function isContentKind(value: unknown): value is ContentKind {
	return typeof value === "string" && (ALL_KINDS as string[]).includes(value);
}
