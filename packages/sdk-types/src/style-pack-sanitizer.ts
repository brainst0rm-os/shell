/**
 * StylePack CSS **bundle validator** (docs/apps/40-theme-store.md
 * §Validation; OQ-183). A `brainstorm/StylePack/v1` ships raw CSS, so —
 * unlike the passive token/icon/typography pieces — it must be scanned for
 * the script / network / exfil vectors that CSS can still carry. A pack
 * with any **error**-severity finding never installs (the editor blocks
 * Save; the CLI `pack` exits non-zero; the installer rejects the bundle).
 *
 * This is a **conservative lint**, not a full CSS parser: it strips
 * comments (preserving newlines so line numbers stay accurate), then scans
 * case-insensitively for known-dangerous constructs, allowing intervening
 * whitespace so `expression ( … )` / `-moz-binding` obfuscation can't slip
 * past. When a construct is ambiguous it is flagged rather than allowed
 * (fail-closed). v1 StylePacks are self-contained (no bundled assets / no
 * asset pipeline yet), so ALL network references are rejected outright.
 *
 * Pure + dependency-free leaf — no DOM, no regex backtracking on attacker
 * input beyond bounded comment stripping. Barrel-re-exported.
 */

/** Severity of a sanitizer finding. Only `Error` blocks install/save. */
export enum StylePackSanitizeSeverity {
	Error = "error",
	Warning = "warning",
}

/** Stable codes for StylePack CSS security findings. */
export enum StylePackSanitizeCode {
	/** A `javascript:` / `vbscript:` scheme anywhere in the CSS. */
	ScriptUrl = "script-url",
	/** A `url()` pointing at a network origin (`http(s)://`, `//`, `ftp://`). */
	ExternalResource = "external-resource",
	/** Any `@import` — packs are self-contained; cross-origin or not, it's out. */
	NetworkImport = "network-import",
	/** Legacy XBL binding (`-moz-binding`) — can load + run external markup. */
	MozBinding = "moz-binding",
	/** IE `behavior:` / `-ms-behavior` HTC script attachment. */
	Behavior = "behavior",
	/** IE dynamic `expression(...)` — runs script. */
	Expression = "expression",
	/** A `data:` URI — local, but can embed SVG/markup; flagged for review. */
	DataUri = "data-uri",
}

export type StylePackSanitizeIssue = {
	code: StylePackSanitizeCode;
	severity: StylePackSanitizeSeverity;
	message: string;
	/** 1-based line of the first character of the match in the original CSS. */
	line: number;
	/** The matched fragment (trimmed, capped) for editor display. */
	snippet: string;
};

type Detector = {
	code: StylePackSanitizeCode;
	severity: StylePackSanitizeSeverity;
	message: string;
	pattern: RegExp;
};

/** Replace each `/* … *​/` comment with spaces, preserving newlines so
 *  match offsets still map to the right line in the original source. */
function stripComments(css: string): string {
	return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Decode CSS character escapes so the detectors see the construct a BROWSER
 * sees, not the obfuscated source. Per the CSS Syntax spec, escapes resolve
 * during tokenization of identifiers / function names / at-keywords — so
 * `\75 rl(…)` IS a `url()`, `@\69 mport` IS `@import`, `https:\2f\2f` IS
 * `https://`. Without decoding, every detector regex is trivially bypassed.
 * Whitespace/control results collapse to a space (token-breaking but
 * never adding a newline, so line numbers stay stable); a literal newline
 * is preserved so line counting doesn't drift. Normal (escape-free) CSS is
 * unchanged — no false positives, offsets identical.
 */
function decodeCssEscapes(css: string): string {
	if (!css.includes("\\")) return css;
	return (
		css
			// Hex escape: `\` + 1–6 hex digits + one optional trailing whitespace.
			.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\f]?/g, (_m, hex: string) => {
				const cp = Number.parseInt(hex, 16);
				if (!Number.isFinite(cp) || cp === 0 || cp > 0x10ffff) return " ";
				const ch = String.fromCodePoint(cp);
				return /\s/.test(ch) ? " " : ch;
			})
			// Any other escape: `\` + a single non-newline char → that char
			// (a `\<newline>` is a line continuation — leave it so a line isn't lost).
			.replace(/\\([^\n])/g, "$1")
	);
}

function lineOf(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < text.length; i++) {
		if (text.charCodeAt(i) === 10) line++;
	}
	return line;
}

const MAX_SNIPPET = 80;

function snippetOf(match: string): string {
	const collapsed = match.replace(/\s+/g, " ").trim();
	return collapsed.length > MAX_SNIPPET ? `${collapsed.slice(0, MAX_SNIPPET - 1)}…` : collapsed;
}

/**
 * The detector table. Each pattern is global + case-insensitive and allows
 * intervening whitespace inside the dangerous token. Order is fixed so
 * findings are deterministic.
 */
const DETECTORS: readonly Detector[] = Object.freeze([
	{
		code: StylePackSanitizeCode.ScriptUrl,
		severity: StylePackSanitizeSeverity.Error,
		message: "Script-scheme URL (javascript:/vbscript:) is not allowed.",
		pattern: /(?:java|vb)script\s*:/gi,
	},
	{
		code: StylePackSanitizeCode.NetworkImport,
		severity: StylePackSanitizeSeverity.Error,
		message: "@import is not allowed — style packs must be self-contained.",
		pattern: /@import\b/gi,
	},
	{
		code: StylePackSanitizeCode.MozBinding,
		severity: StylePackSanitizeSeverity.Error,
		message: "-moz-binding can load and run external markup; not allowed.",
		pattern: /-moz-binding\s*:/gi,
	},
	{
		code: StylePackSanitizeCode.Behavior,
		severity: StylePackSanitizeSeverity.Error,
		message: "behavior: attaches script (HTC); not allowed.",
		pattern: /(?:-ms-)?behavior\s*:/gi,
	},
	{
		code: StylePackSanitizeCode.Expression,
		severity: StylePackSanitizeSeverity.Error,
		message: "expression(...) runs script; not allowed.",
		pattern: /expression\s*\(/gi,
	},
	{
		code: StylePackSanitizeCode.ExternalResource,
		severity: StylePackSanitizeSeverity.Error,
		message: "External resource fetch (network origin) is not allowed.",
		// Any absolute network URL — a self-contained pack has no business
		// containing one anywhere (url(), image-set(), @import, font src, …).
		// `(scheme)://` catches http/https/ftp/ws; `url(//…)` catches the
		// protocol-relative form. Run AFTER decodeCssEscapes so escaped
		// variants (`\75 rl`, `https:\2f\2f`) are already normalized.
		pattern: /(?:https?|ftp|wss?):\/\/|url\(\s*['"]?\s*\/\//gi,
	},
	{
		code: StylePackSanitizeCode.DataUri,
		severity: StylePackSanitizeSeverity.Warning,
		message: "data: URI embeds inline content; review it before publishing.",
		pattern: /url\(\s*['"]?\s*data:/gi,
	},
]);

/**
 * Scan StylePack CSS and return every security finding (`[]` ⇒ clean).
 * Findings are sorted by line then code so the editor's problem list is
 * stable across runs.
 */
export function sanitizeStylePackCss(css: string): StylePackSanitizeIssue[] {
	if (typeof css !== "string" || css.length === 0) return [];
	// Strip comments (line-preserving) THEN decode escapes so a detector sees
	// the same construct the browser tokenizer will — `\75 rl(` ⇒ `url(` etc.
	const stripped = decodeCssEscapes(stripComments(css));
	const issues: StylePackSanitizeIssue[] = [];
	for (const detector of DETECTORS) {
		detector.pattern.lastIndex = 0;
		let match: RegExpExecArray | null = detector.pattern.exec(stripped);
		while (match !== null) {
			issues.push({
				code: detector.code,
				severity: detector.severity,
				message: detector.message,
				line: lineOf(stripped, match.index),
				snippet: snippetOf(match[0]),
			});
			// Guard against zero-width matches looping forever.
			if (match.index === detector.pattern.lastIndex) detector.pattern.lastIndex++;
			match = detector.pattern.exec(stripped);
		}
	}
	issues.sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
	return issues;
}

/** `true` iff the CSS has no **error**-severity finding (warnings allowed). */
export function isStylePackCssSafe(css: string): boolean {
	return !sanitizeStylePackCss(css).some((i) => i.severity === StylePackSanitizeSeverity.Error);
}
