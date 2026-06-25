/**
 * Small, safe markdown → DOM converter. Used by the markdown renderer
 * for the 9.20.1.5 preview drop.
 *
 * Why hand-rolled: the renderer can't reach any external markdown lib
 * (size-budget cost) and inline strings + `innerHTML` are an XSS class
 * we shouldn't carry into the sandbox. This builder constructs DOM
 * nodes one at a time — every user-supplied string becomes a text node,
 * never an HTML fragment. The output tree is XSS-safe by construction.
 *
 * Subset:
 *   - Headings: `# `, `## `, `### `, `#### `
 *   - Paragraphs (blank-line separated)
 *   - Fenced code blocks (``` ```)
 *   - Bullet lists (`- ` / `* `)
 *   - Ordered lists (`1. ` etc.)
 *   - Horizontal rule: `---` on its own line
 *   - Inline: \\\`code\\\`, **bold**, *italic*, [text](url)
 *
 * Out of scope (would need a real parser): nested lists, blockquotes,
 * tables, autolinks, reference-style links, image embeds, footnotes,
 * setext headings, raw HTML.
 */

/** Safe URL schemes for `[text](url)`. Everything else becomes plain text. */
const SAFE_LINK_PREFIXES: ReadonlyArray<string> = ["http://", "https://", "mailto:", "brainstorm:"];

/** Top-level block kinds the parser emits. Renderer translates each to a DOM node. */
export enum BlockKind {
	Heading = "heading",
	Paragraph = "paragraph",
	CodeFence = "code-fence",
	BulletList = "bullet-list",
	OrderedList = "ordered-list",
	HorizontalRule = "horizontal-rule",
}

export type MarkdownBlock =
	| { kind: BlockKind.Heading; level: 1 | 2 | 3 | 4; text: string }
	| { kind: BlockKind.Paragraph; text: string }
	| { kind: BlockKind.CodeFence; language: string | null; code: string }
	| { kind: BlockKind.BulletList; items: ReadonlyArray<string> }
	| { kind: BlockKind.OrderedList; items: ReadonlyArray<string> }
	| { kind: BlockKind.HorizontalRule };

/** Parse a markdown document into a flat block list. Pure — no DOM access. */
export function parseMarkdown(source: string): ReadonlyArray<MarkdownBlock> {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const blocks: MarkdownBlock[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] ?? "";

		if (line.trim() === "") {
			i++;
			continue;
		}

		// Fenced code block
		const fence = line.match(/^```(\w*)\s*$/);
		if (fence) {
			const lang = fence[1] ?? "";
			const language = lang.trim() || null;
			i++;
			const start = i;
			while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
				i++;
			}
			const code = lines.slice(start, i).join("\n");
			if (i < lines.length) i++; // consume closing fence
			blocks.push({ kind: BlockKind.CodeFence, language, code });
			continue;
		}

		// Horizontal rule
		if (/^---+\s*$/.test(line)) {
			blocks.push({ kind: BlockKind.HorizontalRule });
			i++;
			continue;
		}

		// Heading
		const heading = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
		if (heading) {
			const hashes = heading[1] ?? "";
			const level = clampHeadingLevel(hashes.length);
			blocks.push({ kind: BlockKind.Heading, level, text: heading[2] ?? "" });
			i++;
			continue;
		}

		// Bullet list
		if (/^[-*]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^[-*]\s+/.test(lines[i] ?? "")) {
				items.push((lines[i] ?? "").replace(/^[-*]\s+/, ""));
				i++;
			}
			blocks.push({ kind: BlockKind.BulletList, items });
			continue;
		}

		// Ordered list
		if (/^\d+\.\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\d+\.\s+/.test(lines[i] ?? "")) {
				items.push((lines[i] ?? "").replace(/^\d+\.\s+/, ""));
				i++;
			}
			blocks.push({ kind: BlockKind.OrderedList, items });
			continue;
		}

		// Paragraph — slurp non-blank, non-heading, non-fence, non-list lines.
		const para: string[] = [line];
		i++;
		while (i < lines.length) {
			const next = lines[i] ?? "";
			if (next.trim() === "") break;
			if (/^#{1,4}\s+/.test(next)) break;
			if (/^```/.test(next)) break;
			if (/^[-*]\s+/.test(next)) break;
			if (/^\d+\.\s+/.test(next)) break;
			if (/^---+\s*$/.test(next)) break;
			para.push(next);
			i++;
		}
		blocks.push({ kind: BlockKind.Paragraph, text: para.join(" ") });
	}

	return blocks;
}

/** Render a parsed block list into a DOM container. Returns the
 *  container so the caller can place it anywhere. `doc` is the
 *  document factory (passed in for testability — JSDOM in tests). */
export function renderBlocksToDom(
	blocks: ReadonlyArray<MarkdownBlock>,
	doc: Document,
): HTMLElement {
	const root = doc.createElement("div");
	root.className = "preview-markdown__doc";
	for (const block of blocks) {
		root.appendChild(renderBlock(block, doc));
	}
	return root;
}

function renderBlock(block: MarkdownBlock, doc: Document): HTMLElement {
	switch (block.kind) {
		case BlockKind.Heading: {
			const el = doc.createElement(`h${block.level}`);
			el.className = "preview-markdown__heading";
			renderInlineInto(block.text, el, doc);
			return el;
		}
		case BlockKind.Paragraph: {
			const el = doc.createElement("p");
			el.className = "preview-markdown__paragraph";
			renderInlineInto(block.text, el, doc);
			return el;
		}
		case BlockKind.CodeFence: {
			const wrap = doc.createElement("pre");
			wrap.className = "preview-markdown__code";
			const code = doc.createElement("code");
			if (block.language) code.setAttribute("data-language", block.language);
			code.textContent = block.code;
			wrap.appendChild(code);
			return wrap;
		}
		case BlockKind.BulletList: {
			const ul = doc.createElement("ul");
			ul.className = "preview-markdown__list";
			for (const item of block.items) {
				const li = doc.createElement("li");
				renderInlineInto(item, li, doc);
				ul.appendChild(li);
			}
			return ul;
		}
		case BlockKind.OrderedList: {
			const ol = doc.createElement("ol");
			ol.className = "preview-markdown__list";
			for (const item of block.items) {
				const li = doc.createElement("li");
				renderInlineInto(item, li, doc);
				ol.appendChild(li);
			}
			return ol;
		}
		case BlockKind.HorizontalRule: {
			return doc.createElement("hr");
		}
	}
}

// Pathological `***...***` nests recurse one level per emphasis pair;
// 32 covers any plausible doc, blocks deeply hostile inputs.
const MAX_INLINE_DEPTH = 32;

/** Render inline marks (code / bold / italic / link) into `parent`.
 *  Walks the string once, greedily matching the next inline marker. */
export function renderInlineInto(
	source: string,
	parent: HTMLElement,
	doc: Document,
	depth = 0,
): void {
	if (depth > MAX_INLINE_DEPTH) {
		parent.appendChild(doc.createTextNode(source));
		return;
	}
	let i = 0;
	let buffer = "";

	function flushText(): void {
		if (buffer.length === 0) return;
		parent.appendChild(doc.createTextNode(buffer));
		buffer = "";
	}

	while (i < source.length) {
		const ch = source[i];

		// Inline code: `…`
		if (ch === "`") {
			const close = source.indexOf("`", i + 1);
			if (close > i) {
				flushText();
				const code = doc.createElement("code");
				code.className = "preview-markdown__inline-code";
				code.textContent = source.slice(i + 1, close);
				parent.appendChild(code);
				i = close + 1;
				continue;
			}
		}

		// Bold: **…**
		if (ch === "*" && source[i + 1] === "*") {
			const close = source.indexOf("**", i + 2);
			if (close > i + 1) {
				flushText();
				const strong = doc.createElement("strong");
				renderInlineInto(source.slice(i + 2, close), strong, doc, depth + 1);
				parent.appendChild(strong);
				i = close + 2;
				continue;
			}
		}

		// Italic: *…* (single-star)
		if (ch === "*") {
			const close = source.indexOf("*", i + 1);
			if (close > i) {
				flushText();
				const em = doc.createElement("em");
				renderInlineInto(source.slice(i + 1, close), em, doc, depth + 1);
				parent.appendChild(em);
				i = close + 1;
				continue;
			}
		}

		// Link: [text](url)
		if (ch === "[") {
			const closeText = source.indexOf("]", i + 1);
			if (closeText > i && source[closeText + 1] === "(") {
				const closeUrl = source.indexOf(")", closeText + 2);
				if (closeUrl > closeText) {
					const text = source.slice(i + 1, closeText);
					const url = source.slice(closeText + 2, closeUrl);
					if (isSafeLinkUrl(url)) {
						flushText();
						const a = doc.createElement("a");
						a.setAttribute("href", url);
						a.setAttribute("rel", "noreferrer noopener");
						a.setAttribute("target", "_blank");
						a.className = "preview-markdown__link";
						a.textContent = text;
						parent.appendChild(a);
						i = closeUrl + 1;
						continue;
					}
				}
			}
		}

		buffer += ch ?? "";
		i++;
	}
	flushText();
}

export function isSafeLinkUrl(raw: string): boolean {
	const url = raw.trim().toLowerCase();
	for (const prefix of SAFE_LINK_PREFIXES) {
		if (url.startsWith(prefix)) return true;
	}
	return false;
}

/** Quick word count over the parsed-block text content. Used by the
 *  inspector pane metadata. */
export function wordCountForMarkdown(source: string): number {
	const blocks = parseMarkdown(source);
	let words = 0;
	for (const block of blocks) {
		if (block.kind === BlockKind.Heading || block.kind === BlockKind.Paragraph) {
			words += countWords(block.text);
		} else if (block.kind === BlockKind.BulletList || block.kind === BlockKind.OrderedList) {
			for (const item of block.items) words += countWords(item);
		}
		// code fences + rules don't count toward word totals.
	}
	return words;
}

function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/).length;
}

function clampHeadingLevel(n: number): 1 | 2 | 3 | 4 {
	if (n <= 1) return 1;
	if (n === 2) return 2;
	if (n === 3) return 3;
	return 4;
}
