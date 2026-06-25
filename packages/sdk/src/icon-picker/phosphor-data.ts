/**
 * Full Phosphor manifest — eagerly imported from `@phosphor-icons/core`
 * (1530 icons across 18 categories). React components live in a separate
 * package (`@phosphor-icons/react`) that's lazy-loaded via
 * `loadPhosphorReact()` so the main Notes bundle stays small; the picker
 * triggers the import when its Icon tab mounts, and `EntityIcon` waits
 * on the same promise (kicks it off on first Pack-icon render).
 */

import { icons as RAW_PHOSPHOR_ICONS } from "@phosphor-icons/core";
import type { ComponentType } from "react";

export type PhosphorMeta = {
	name: string;
	pascal: string;
	categories: readonly string[];
	tags: readonly string[];
};

export type PhosphorGroup = {
	name: string;
	icons: readonly PhosphorMeta[];
};

export type PhosphorComponent = ComponentType<{
	size?: number | string;
	weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
	color?: string;
	mirrored?: boolean;
}>;

export const PHOSPHOR_PACK_ID = "phosphor";

export const PHOSPHOR_ICONS: readonly PhosphorMeta[] = RAW_PHOSPHOR_ICONS.map((entry) => ({
	name: entry.name,
	pascal: entry.pascal_name,
	categories: entry.categories.map((c) => c.toString()),
	tags: [...entry.tags],
}));

const BY_NAME = new Map<string, PhosphorMeta>(PHOSPHOR_ICONS.map((m) => [m.name, m]));

/** Group icons by their primary category for the picker's section headers.
 *  An icon listed under multiple categories appears under its first one. */
export const PHOSPHOR_GROUPS: readonly PhosphorGroup[] = (() => {
	const groups = new Map<string, PhosphorMeta[]>();
	for (const icon of PHOSPHOR_ICONS) {
		const cat = icon.categories[0] ?? "other";
		const list = groups.get(cat) ?? [];
		list.push(icon);
		groups.set(cat, list);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, icons]) => ({ name: prettifyCategory(name), icons }));
})();

export function searchPhosphor(query: string): readonly PhosphorMeta[] {
	const q = query.trim().toLowerCase();
	if (!q) return PHOSPHOR_ICONS;
	return PHOSPHOR_ICONS.filter(
		(icon) => icon.name.includes(q) || icon.tags.some((tag) => tag.toLowerCase().includes(q)),
	);
}

export function findPhosphor(name: string): PhosphorMeta | undefined {
	return BY_NAME.get(name);
}

// ─── React component lazy-load ──────────────────────────────────────────

type PhosphorReactModule = Record<string, PhosphorComponent>;

let cached: PhosphorReactModule | null = null;
let inFlight: Promise<PhosphorReactModule> | null = null;
const subscribers = new Set<() => void>();

export function loadPhosphorReact(): Promise<PhosphorReactModule> {
	if (cached) return Promise.resolve(cached);
	if (inFlight) return inFlight;
	inFlight = import("@phosphor-icons/react").then((mod) => {
		cached = mod as unknown as PhosphorReactModule;
		for (const fn of subscribers) fn();
		return cached;
	});
	return inFlight;
}

/** Subscribe to "Phosphor React module loaded" — used by `EntityIcon` so
 *  Pack icons that needed the module re-render once it arrives. */
export function subscribePhosphorReact(fn: () => void): () => void {
	subscribers.add(fn);
	return () => {
		subscribers.delete(fn);
	};
}

/** Synchronous lookup — returns `null` until the React module is loaded.
 *  Callers should subscribe via `subscribePhosphorReact` to know when to
 *  re-try. Triggers a load on first miss so the chunk is in flight by
 *  the time the caller subscribes. */
export function tryGetPhosphorComponent(name: string): PhosphorComponent | null {
	const meta = BY_NAME.get(name);
	if (!meta) return null;
	if (!cached) {
		void loadPhosphorReact();
		return null;
	}
	return cached[meta.pascal] ?? null;
}

function prettifyCategory(slug: string): string {
	return slug
		.split(/[\s&]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" & ");
}
