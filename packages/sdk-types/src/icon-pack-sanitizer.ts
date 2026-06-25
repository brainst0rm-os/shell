/**
 * IconPack glyph **SVG sanitizer** (docs/apps/40-theme-store.md §Validation).
 * A `brainstorm/IconPack/v1` ships raw SVG markup that the renderer injects
 * verbatim into a `dangerouslySetInnerHTML` / `innerHTML` sink in EVERY app
 * renderer AND the privileged dashboard — so, like the sibling StylePack CSS
 * (`style-pack-sanitizer.ts`), it must be scanned for the script vectors SVG
 * can carry before it ever reaches a sink. A marketplace/imported pack is
 * untrusted vault content; an unsanitized glyph achieves stored XSS across
 * the cross-app isolation boundary.
 *
 * SVG active-content vectors this strips: `<script>`; `<foreignObject>`
 * (carries arbitrary HTML + handlers); the SMIL animation elements
 * `<animate>` / `<animateTransform>` / `<animateMotion>` / `<set>` (their
 * `onbegin` / `onend` / `href="javascript:"` run script); `<use>` with a
 * non-fragment (external / `javascript:`) reference; every `on*`
 * event-handler attribute; and `javascript:` / `vbscript:` / `data:text/html`
 * URLs in `href` / `xlink:href` / `src`.
 *
 * Posture mirrors StylePack: a conservative, **fail-closed** lint that
 * prefers stripping the unsafe construct and keeping the safe glyph (a
 * benign `<path>` survives). It is NOT a full XML parser — it is a bounded
 * string/regex pass that, like the CSS sanitizer, first decodes the entity
 * escapes a browser would resolve so an obfuscated `j&#97;vascript:` /
 * `&lt;script&gt;`-after-decode construct can't slip past.
 *
 * Pure + dependency-free leaf — no DOM / no DOMParser (runs in node tests
 * and the Electron renderer alike), no regex backtracking on attacker input
 * beyond bounded element/attribute stripping. Barrel-re-exported.
 */

/** Severity of an IconPack SVG finding. Only `Error` is unsafe. */
export enum IconPackSvgSanitizeSeverity {
	Error = "error",
}

/** Stable codes for IconPack glyph SVG security findings. */
export enum IconPackSvgSanitizeCode {
	/** A `<script>` element. */
	ScriptElement = "script-element",
	/** A `<foreignObject>` — carries arbitrary HTML + event handlers. */
	ForeignObject = "foreign-object",
	/** A SMIL animation element (`<animate*>` / `<set>`) — `onbegin`/href run script. */
	AnimationElement = "animation-element",
	/** A `<use>` referencing a non-fragment (external / `javascript:`) target. */
	ExternalUse = "external-use",
	/** An `on*` event-handler attribute (`onload`, `onbegin`, `onclick`, …). */
	EventHandler = "event-handler",
	/** A `javascript:` / `vbscript:` / `data:text/html` URL in href/xlink:href/src. */
	ScriptUrl = "script-url",
}

export type IconPackSvgSanitizeIssue = {
	code: IconPackSvgSanitizeCode;
	severity: IconPackSvgSanitizeSeverity;
	message: string;
	/** The matched fragment (collapsed, capped) for editor display. */
	snippet: string;
};

const MAX_SNIPPET = 80;

function snippetOf(match: string): string {
	const collapsed = match.replace(/\s+/g, " ").trim();
	return collapsed.length > MAX_SNIPPET ? `${collapsed.slice(0, MAX_SNIPPET - 1)}…` : collapsed;
}

/**
 * Decode the HTML/XML character references a browser resolves while parsing
 * markup, so the detectors see the construct the parser sees, not the
 * obfuscated source: `&#106;avascript:` / `&#x6a;…` / `&lt;script&gt;`
 * become `javascript:` / `<script>`. Numeric refs (decimal + hex, with or
 * without the trailing `;`) and the handful of named refs that matter for
 * the vectors here (`lt`/`gt`/`amp`/`quot`/`apos`/`colon`/`Tab`/`NewLine`)
 * are resolved. `&amp;` is decoded LAST so `&amp;#106;` collapses to `j`
 * (defeating double-encoding). Escape-free markup is unchanged.
 */
function decodeEntities(svg: string): string {
	if (!svg.includes("&")) return svg;
	const named: Record<string, string> = {
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		colon: ":",
		Tab: " ",
		NewLine: "\n",
	};
	return svg
		.replace(/&#x([0-9a-fA-F]+);?/g, (_m, hex: string) => fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#([0-9]+);?/g, (_m, dec: string) => fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&([a-zA-Z]+);/g, (m, name: string) => named[name] ?? m)
		.replace(/&amp;/gi, "&");
}

function fromCodePoint(cp: number): string {
	if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
	return String.fromCodePoint(cp);
}

/** Element names whose entire subtree is active content and must be removed. */
const DANGEROUS_ELEMENTS = [
	"script",
	"foreignObject",
	"animate",
	"animateTransform",
	"animateMotion",
	"set",
] as const;

function codeForElement(name: string): IconPackSvgSanitizeCode {
	if (name === "script") return IconPackSvgSanitizeCode.ScriptElement;
	if (name === "foreignObject") return IconPackSvgSanitizeCode.ForeignObject;
	return IconPackSvgSanitizeCode.AnimationElement;
}

/** `<el …> … </el>` (balanced-ish, non-greedy) OR a self-closing/void
 *  `<el … />` / `<el …>` of the same name. Case-insensitive. */
function elementPattern(name: string): RegExp {
	const e = escapeRegExp(name);
	return new RegExp(`<${e}\\b[^>]*?(?:/\\s*>|>[\\s\\S]*?<\\s*/\\s*${e}\\s*>|>)`, "gi");
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const EVENT_HANDLER_ATTR = /\son[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/** A scripting / html-payload URL in any value: `javascript:` / `vbscript:`
 *  (whitespace-tolerant) or a `data:text/html` URI. */
const SCRIPT_URL = /(?:j\s*a\s*v\s*a|v\s*b)\s*s\s*c\s*r\s*i\s*p\s*t\s*:|data:text\/html/gi;

/** A whole `href` / `xlink:href` / `src` attribute carrying a scripting URL,
 *  so the entire attribute (not just the scheme) is removed. */
const SCRIPT_URL_ATTR = /\s(?:xlink:)?(?:href|src)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/** A `<use>` whose href/xlink:href is NOT a same-document fragment
 *  (`#id`) — i.e. external or `javascript:`. Captures the element so the
 *  whole `<use>` is removed. */
function findExternalUse(svg: string): RegExpExecArray | null {
	const pattern = /<use\b[^>]*?(?:\/\s*>|>)/gi;
	pattern.lastIndex = 0;
	let m: RegExpExecArray | null = pattern.exec(svg);
	while (m !== null) {
		const tag = m[0];
		const ref = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
		const value = ref ? (ref[1] ?? ref[2] ?? ref[3] ?? "").trim() : "";
		if (value.length > 0 && !value.startsWith("#")) return m;
		m = pattern.exec(svg);
	}
	return null;
}

/**
 * Scan glyph SVG and return every security finding (`[]` ⇒ clean). Runs on
 * the entity-decoded markup so an escaped vector is caught.
 */
export function findIconPackSvgIssues(svg: string): IconPackSvgSanitizeIssue[] {
	if (typeof svg !== "string" || svg.length === 0) return [];
	const decoded = decodeEntities(svg);
	const issues: IconPackSvgSanitizeIssue[] = [];

	for (const name of DANGEROUS_ELEMENTS) {
		const pattern = elementPattern(name);
		let m: RegExpExecArray | null = pattern.exec(decoded);
		while (m !== null) {
			issues.push({
				code: codeForElement(name),
				severity: IconPackSvgSanitizeSeverity.Error,
				message: `<${name}> is active content and is not allowed in a glyph.`,
				snippet: snippetOf(m[0]),
			});
			if (m.index === pattern.lastIndex) pattern.lastIndex++;
			m = pattern.exec(decoded);
		}
	}

	const externalUse = findExternalUse(decoded);
	if (externalUse) {
		issues.push({
			code: IconPackSvgSanitizeCode.ExternalUse,
			severity: IconPackSvgSanitizeSeverity.Error,
			message: "<use> may only reference a same-document fragment (#id).",
			snippet: snippetOf(externalUse[0]),
		});
	}

	EVENT_HANDLER_ATTR.lastIndex = 0;
	let handler: RegExpExecArray | null = EVENT_HANDLER_ATTR.exec(decoded);
	while (handler !== null) {
		issues.push({
			code: IconPackSvgSanitizeCode.EventHandler,
			severity: IconPackSvgSanitizeSeverity.Error,
			message: "An on* event-handler attribute is not allowed.",
			snippet: snippetOf(handler[0]),
		});
		handler = EVENT_HANDLER_ATTR.exec(decoded);
	}

	SCRIPT_URL.lastIndex = 0;
	let url: RegExpExecArray | null = SCRIPT_URL.exec(decoded);
	while (url !== null) {
		issues.push({
			code: IconPackSvgSanitizeCode.ScriptUrl,
			severity: IconPackSvgSanitizeSeverity.Error,
			message: "A javascript:/vbscript:/data:text/html URL is not allowed.",
			snippet: snippetOf(url[0]),
		});
		if (url.index === SCRIPT_URL.lastIndex) SCRIPT_URL.lastIndex++;
		url = SCRIPT_URL.exec(decoded);
	}

	return issues;
}

/** `true` iff the glyph SVG has no security finding. */
export function isIconPackSvgSafe(svg: string): boolean {
	return findIconPackSvgIssues(svg).length === 0;
}

/**
 * Return the glyph SVG with every active-content vector removed — the clean
 * markup safe to drop into the renderer's `dangerouslySetInnerHTML` /
 * `innerHTML` sink. A benign glyph (`<svg><path d="…"/></svg>`) is returned
 * unchanged; an unsafe one has its `<script>`/`<foreignObject>`/animation
 * elements + external `<use>` + `on*` handlers + scripting URLs stripped.
 *
 * Strips iteratively until the markup is clean (so a vector revealed by
 * removing an outer wrapper is still caught), with a fixed iteration cap as
 * a backstop against pathological input.
 */
export function sanitizeIconPackSvg(svg: string): string {
	if (typeof svg !== "string" || svg.length === 0) return "";
	let out = decodeEntities(svg);
	for (let pass = 0; pass < 8; pass++) {
		const before = out;
		for (const name of DANGEROUS_ELEMENTS) {
			out = out.replace(elementPattern(name), "");
		}
		out = stripExternalUse(out);
		out = out.replace(EVENT_HANDLER_ATTR, "");
		out = out.replace(SCRIPT_URL_ATTR, (attr) => (SCRIPT_URL.test(attr) ? "" : attr));
		if (out === before) break;
	}
	return out;
}

function stripExternalUse(svg: string): string {
	return svg.replace(/<use\b[^>]*?(?:\/\s*>|>)/gi, (tag) => {
		const ref = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
		const value = ref ? (ref[1] ?? ref[2] ?? ref[3] ?? "").trim() : "";
		if (value.length > 0 && !value.startsWith("#")) return "";
		return tag;
	});
}
