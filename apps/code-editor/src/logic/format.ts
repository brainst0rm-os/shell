/**
 * Formatter integration (9.7.8) — Prettier (standalone build) for the
 * web languages the editor already highlights. Plugins load lazily per
 * language family (Vite code-splits each `import()`), so the formatter
 * costs nothing until first use. External-binary formatters (Black /
 * rustfmt) need a shell-side process broker and are deliberately out of
 * scope here — `canFormat` is the single gate every affordance keys on.
 */

import { LanguageKey } from "../types/code-file";

interface PrettierLike {
	formatWithCursor(
		source: string,
		options: {
			cursorOffset: number;
			parser: string;
			plugins: unknown[];
		},
	): Promise<{ formatted: string; cursorOffset: number }>;
}

type PluginLoader = () => Promise<unknown>;

interface FormatterSpec {
	parser: string;
	plugins: PluginLoader[];
}

const estree: PluginLoader = () => import("prettier/plugins/estree");
const babel: PluginLoader = () => import("prettier/plugins/babel");
const typescript: PluginLoader = () => import("prettier/plugins/typescript");
const postcss: PluginLoader = () => import("prettier/plugins/postcss");
const html: PluginLoader = () => import("prettier/plugins/html");
const markdown: PluginLoader = () => import("prettier/plugins/markdown");

const FORMATTERS: Partial<Record<LanguageKey, FormatterSpec>> = {
	[LanguageKey.TypeScript]: { parser: "typescript", plugins: [typescript, estree] },
	[LanguageKey.TSX]: { parser: "typescript", plugins: [typescript, estree] },
	[LanguageKey.JavaScript]: { parser: "babel", plugins: [babel, estree] },
	[LanguageKey.JSX]: { parser: "babel", plugins: [babel, estree] },
	[LanguageKey.JSON]: { parser: "json", plugins: [babel, estree] },
	[LanguageKey.JSONC]: { parser: "json", plugins: [babel, estree] },
	[LanguageKey.CSS]: { parser: "css", plugins: [postcss] },
	// Embedded <style>/<script> formatting inside HTML needs the css/js
	// plugins alongside the html one.
	[LanguageKey.HTML]: { parser: "html", plugins: [html, postcss, babel, estree] },
	[LanguageKey.Markdown]: { parser: "markdown", plugins: [markdown] },
};

/** Whether `language` has a Prettier parser wired. The one gate every
 *  format affordance (chord, palette, menu toggle, on-save hook) uses. */
export function canFormat(language: LanguageKey): boolean {
	return FORMATTERS[language] !== undefined;
}

export interface FormatResult {
	formatted: string;
	cursorOffset: number;
}

/**
 * Format `content` for `language`, mapping `cursorOffset` through the
 * rewrite (Prettier's `formatWithCursor`). Returns `null` for an
 * unformattable language or a parse error (syntax errors must never
 * break save / the keystroke path — the buffer stays untouched).
 */
export async function formatCode(
	content: string,
	language: LanguageKey,
	cursorOffset: number,
): Promise<FormatResult | null> {
	const spec = FORMATTERS[language];
	if (!spec) return null;
	try {
		const [standalone, ...plugins] = await Promise.all([
			import("prettier/standalone") as Promise<PrettierLike>,
			...spec.plugins.map((load) => load()),
		]);
		const result = await standalone.formatWithCursor(content, {
			cursorOffset: Math.max(0, Math.min(cursorOffset, content.length)),
			parser: spec.parser,
			plugins,
		});
		return { formatted: result.formatted, cursorOffset: result.cursorOffset };
	} catch {
		return null;
	}
}
