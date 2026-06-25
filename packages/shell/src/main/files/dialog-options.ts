/**
 * 9.10 keystone — pure normalization of app-supplied `files.requestOpen`
 * / `files.requestSave` options into the safe internal shape the broker
 * handler feeds to Electron's `dialog.show{Open,Save}Dialog`.
 *
 * App input is untrusted. Two security invariants this enforces before
 * a native picker ever opens (and before a `FileHandle` is minted):
 *
 *  1. **The app never influences *where*.** It may *suggest* a leaf
 *     filename for Save, but `sanitizeSuggestedName` strips every path
 *     separator / `..` / control char / leading dot, so a hostile
 *     `../../.ssh/authorized_keys` collapses to a bare basename — the
 *     user's chosen directory is the only directory (the opaque-handle
 *  model, §Filesystem).
 *  2. **Filters are well-formed + bounded.** Extensions are lower-cased,
 *     dot-stripped, charset-restricted, de-duped and capped; malformed
 *     filter entries are dropped, not thrown on — a bad `filters` array
 *     degrades to "no filter" rather than failing the call.
 *
 * Mirrors the covers/registry "fail-safe, never throw on bad app input"
 * posture; pairs with `file-handle-registry.ts` (the mode it derives
 * matches what the registry will mint).
 */

import { FileHandleMode } from "./file-handle-registry";

export interface DialogFilter {
	name: string;
	/** Bare extensions, no leading dot — Electron's expected shape. `*`
	 *  is allowed (the all-files filter). */
	extensions: string[];
}

export interface NormalizedOpenDialog {
	title: string | null;
	filters: DialogFilter[];
	/** Multi-select (`requestOpen` may return several handles). */
	multi: boolean;
	mode: FileHandleMode.Read;
}

export interface NormalizedSaveDialog {
	title: string | null;
	filters: DialogFilter[];
	/** A bare basename the picker pre-fills, or `null`. Never a path. */
	suggestedName: string | null;
	mode: FileHandleMode.ReadWrite;
}

/** Defensive caps — an app cannot make the picker config unbounded. */
const MAX_FILTERS = 32;
const MAX_EXTENSIONS_PER_FILTER = 64;
const MAX_NAME_LEN = 255;
const MAX_TITLE_LEN = 200;

/** NUL + C0 control chars + DEL. As a `\u`-escaped class so the source
 *  carries no literal control bytes. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately stripping NUL/C0/DEL from untrusted app-supplied filenames
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function str(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeTitle(value: unknown): string | null {
	const s = str(value);
	if (!s) return null;
	// Single line, bounded — a title is chrome, not a payload.
	const cleaned = s.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
	return cleaned.slice(0, MAX_TITLE_LEN) || null;
}

/**
 * Normalize one extensions list: lower-case, strip a leading dot/space,
 * keep only `[a-z0-9_-]` (plus the bare `*` all-files token), drop
 * empties, de-dupe (stable order), cap length.
 */
export function normalizeExtensions(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		if (typeof item !== "string") continue;
		const cleaned = item.trim().toLowerCase().replace(/^\.+/, "");
		if (cleaned === "*") {
			if (!seen.has("*")) {
				seen.add("*");
				out.push("*");
			}
			continue;
		}
		if (!/^[a-z0-9_-]+$/.test(cleaned)) continue;
		if (seen.has(cleaned)) continue;
		seen.add(cleaned);
		out.push(cleaned);
		if (out.length >= MAX_EXTENSIONS_PER_FILTER) break;
	}
	return out;
}

/**
 * Normalize the `filters` array. Each entry needs a non-empty name and
 * at least one valid extension after normalization; anything else is
 * dropped. The whole thing is capped. A non-array yields `[]` (= no
 * filter, the OS shows all files).
 */
export function normalizeFilters(raw: unknown): DialogFilter[] {
	if (!Array.isArray(raw)) return [];
	const out: DialogFilter[] = [];
	for (const entry of raw) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const e = entry as Record<string, unknown>;
		const name = str(e.name);
		if (!name) continue;
		const extensions = normalizeExtensions(e.extensions);
		if (extensions.length === 0) continue;
		out.push({
			name: name.replace(CONTROL_CHARS, "").trim().slice(0, MAX_NAME_LEN),
			extensions,
		});
		if (out.length >= MAX_FILTERS) break;
	}
	return out.filter((f) => f.name.length > 0);
}

/**
 * Reduce an app-suggested Save name to a safe **basename**. Strips any
 * directory component (`/`, `\`), `..`, NUL/control chars and a leading
 * dot (no accidental dotfile / traversal), collapses whitespace, caps
 * length. Returns `null` when nothing usable remains — the picker then
 * uses its own default, and the app still can't point at a path.
 */
export function sanitizeSuggestedName(raw: unknown): string | null {
	const s = str(raw);
	if (!s) return null;
	// Take the last path segment regardless of separator style.
	const lastSlash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
	const segment = lastSlash >= 0 ? s.slice(lastSlash + 1) : s;
	const base = segment
		.replace(CONTROL_CHARS, "")
		.replace(/\.\.+/g, ".")
		.replace(/^\.+/, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_NAME_LEN);
	return base.length > 0 ? base : null;
}

export function normalizeOpenDialog(input: unknown): NormalizedOpenDialog {
	const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	return {
		title: normalizeTitle(o.title),
		filters: normalizeFilters(o.filters),
		multi: o.multi === true,
		mode: FileHandleMode.Read,
	};
}

export function normalizeSaveDialog(input: unknown): NormalizedSaveDialog {
	const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
	return {
		title: normalizeTitle(o.title),
		filters: normalizeFilters(o.filters),
		suggestedName: sanitizeSuggestedName(o.suggestedName),
		mode: FileHandleMode.ReadWrite,
	};
}
