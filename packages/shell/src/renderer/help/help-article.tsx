/**
 * Help-1 — article renderer. Walks the article's markdown into a
 * narrow React tree without touching `innerHTML` so a corpus that ever
 * sneaks raw HTML through can't introduce a renderer-side injection
 * vector. Supported block kinds:
 *
 *   - ATX headings `#…######`
 *   - Paragraphs
 *   - Unordered list items (`- ` / `* ` / `+ `)
 *   - Ordered list items (`1. `, `2. `, …)
 *   - Fenced code blocks (```...```)
 *   - Block quotes (`> `)
 *   - GFM pipe tables
 *
 * Inline marks supported per run:
 *
 *   - `**bold**` / `*emphasis*` / `_emphasis_` / `~~strike~~`
 *   - `` `code` ``
 *   - `[label](url)` — `https?:` / `mailto:` / `brainstorm:` / `#…` /
 *     internal `.md` paths (relative to the article's `relPath` —
 *     rewritten to a `topicId` and clicked via `onOpenTopic`).
 *     Anything else is plain text so we can't open `javascript:` /
 *     `data:` URIs.
 *
 * Anything outside this subset is rendered as plain text — the parser
 * never falls through to HTML. Scroll resets to top whenever the
 * `topicId` changes (a sidebar pick must not inherit prior scroll).
 */

import {
	Fragment,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
} from "react";
import type { HelpArticle as HelpArticleType } from "../../preload";
import { t } from "../i18n/t";

export type HelpArticleProps = {
	readonly article: HelpArticleType | null;
	readonly loading: boolean;
	readonly errorMessage: string | null;
	readonly corpus: readonly HelpArticleType[];
	readonly onOpenTopic: (topicId: string) => void;
};

enum BlockKind {
	Heading = "heading",
	Paragraph = "paragraph",
	UnorderedList = "ul",
	OrderedList = "ol",
	CodeFence = "code",
	BlockQuote = "blockquote",
	Table = "table",
}

type Block =
	| { kind: BlockKind.Heading; depth: number; text: string }
	| { kind: BlockKind.Paragraph; text: string }
	| { kind: BlockKind.UnorderedList; items: string[] }
	| { kind: BlockKind.OrderedList; items: string[] }
	| { kind: BlockKind.CodeFence; language: string; code: string }
	| { kind: BlockKind.BlockQuote; text: string }
	| { kind: BlockKind.Table; head: string[]; rows: string[][] };

export function HelpArticle({
	article,
	loading,
	errorMessage,
	corpus,
	onOpenTopic,
}: HelpArticleProps) {
	const blocks = useMemo(() => (article ? parseBlocks(article.markdown) : []), [article]);
	const bodyRef = useRef<HTMLDivElement>(null);
	const topicId = article?.topicId ?? null;

	useLayoutEffect(() => {
		if (!topicId) return;
		const node = bodyRef.current;
		if (!node) return;
		if (typeof node.scrollTo === "function") {
			node.scrollTo({ top: 0 });
		} else {
			node.scrollTop = 0;
		}
	}, [topicId]);

	const handleBodyClick = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest("a[data-help-topic-id]");
			if (!(anchor instanceof HTMLAnchorElement)) return;
			const next = anchor.dataset.helpTopicId;
			if (!next) return;
			event.preventDefault();
			onOpenTopic(next);
		},
		[onOpenTopic],
	);

	if (loading) {
		return (
			<div className="help__article-state" role="status">
				{t("shell.common.loading")}
			</div>
		);
	}
	if (errorMessage) {
		return (
			<div className="help__article-state help__article-state--error" role="alert">
				{errorMessage}
			</div>
		);
	}
	if (!article) {
		return (
			<div className="help__article-state" role="status">
				{t("shell.help.empty")}
			</div>
		);
	}
	return (
		<article className="help__article" aria-labelledby="help-article-title">
			<header className="help__article-header">
				<h2 id="help-article-title" className="help__article-title" data-testid="help-article-title">
					{article.title}
				</h2>
			</header>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: delegation only — the
			    real focusable targets are <a href> children; Enter on a focused
			    anchor fires a native click that bubbles here. */}
			<div
				className="help__article-body"
				ref={bodyRef}
				data-testid="help-article-body"
				onClick={handleBodyClick}
			>
				{blocks.map((block, i) => (
					<Fragment key={`b-${i}-${blockSignature(block)}`}>
						{renderBlock(block, article, corpus)}
					</Fragment>
				))}
			</div>
		</article>
	);
}

function blockSignature(block: Block): string {
	switch (block.kind) {
		case BlockKind.Heading:
			return `h${block.depth}-${block.text.slice(0, 32)}`;
		case BlockKind.Paragraph:
		case BlockKind.BlockQuote:
			return `${block.kind}-${block.text.slice(0, 32)}`;
		case BlockKind.UnorderedList:
		case BlockKind.OrderedList:
			return `${block.kind}-${block.items.length}-${(block.items[0] ?? "").slice(0, 32)}`;
		case BlockKind.CodeFence:
			return `code-${block.code.slice(0, 32)}`;
		case BlockKind.Table:
			return `table-${block.head.length}-${block.rows.length}`;
	}
}

function renderBlock(
	block: Block,
	article: HelpArticleType,
	corpus: readonly HelpArticleType[],
): ReactNode {
	switch (block.kind) {
		case BlockKind.Heading: {
			const level = Math.min(6, Math.max(2, block.depth + 1));
			const Tag = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";
			return (
				<Tag className={`help__h help__h--${level}`}>{renderInline(block.text, article, corpus)}</Tag>
			);
		}
		case BlockKind.Paragraph:
			return <p className="help__p">{renderInline(block.text, article, corpus)}</p>;
		case BlockKind.UnorderedList:
			return (
				<ul className="help__list">
					{block.items.map((item, i) => (
						<li key={`${i}-${item.slice(0, 32)}`}>{renderInline(item, article, corpus)}</li>
					))}
				</ul>
			);
		case BlockKind.OrderedList:
			return (
				<ol className="help__list help__list--ordered">
					{block.items.map((item, i) => (
						<li key={`${i}-${item.slice(0, 32)}`}>{renderInline(item, article, corpus)}</li>
					))}
				</ol>
			);
		case BlockKind.CodeFence:
			return (
				<pre className="help__code">
					<code>{block.code}</code>
				</pre>
			);
		case BlockKind.BlockQuote:
			return (
				<blockquote className="help__quote">{renderInline(block.text, article, corpus)}</blockquote>
			);
		case BlockKind.Table:
			return (
				<div className="help__table-wrap">
					<table className="help__table">
						<thead>
							<tr>
								{block.head.map((cell, i) => (
									<th key={`h-${i}-${cell.slice(0, 24)}`}>{renderInline(cell, article, corpus)}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{block.rows.map((row, ri) => (
								<tr key={`r-${ri}-${(row[0] ?? "").slice(0, 24)}`}>
									{row.map((cell, ci) => (
										<td key={`c-${ri}-${ci}-${cell.slice(0, 24)}`}>{renderInline(cell, article, corpus)}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
	}
}

function parseBlocks(markdown: string): Block[] {
	const lines = markdown.split("\n");
	const out: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		if (line.trim().length === 0) {
			i += 1;
			continue;
		}
		const fence = line.match(/^```(\S*)\s*$/);
		if (fence) {
			const language = fence[1] ?? "";
			i += 1;
			const code: string[] = [];
			while (i < lines.length && !(lines[i] ?? "").match(/^```\s*$/)) {
				code.push(lines[i] ?? "");
				i += 1;
			}
			if (i < lines.length) i += 1;
			out.push({ kind: BlockKind.CodeFence, language, code: code.join("\n") });
			continue;
		}
		const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
		if (heading) {
			const depth = (heading[1] ?? "").length;
			out.push({ kind: BlockKind.Heading, depth, text: heading[2] ?? "" });
			i += 1;
			continue;
		}
		if (looksLikeTableHeader(lines, i)) {
			const head = splitTableRow(lines[i] ?? "");
			const sepCols = splitTableRow(lines[i + 1] ?? "").length;
			i += 2;
			const rows: string[][] = [];
			while (
				i < lines.length &&
				(lines[i] ?? "").includes("|") &&
				(lines[i] ?? "").trim().length > 0
			) {
				const cells = splitTableRow(lines[i] ?? "");
				if (cells.length === 0) break;
				while (cells.length < head.length) cells.push("");
				if (cells.length > head.length) cells.length = head.length;
				rows.push(cells);
				i += 1;
			}
			void sepCols;
			out.push({ kind: BlockKind.Table, head, rows });
			continue;
		}
		if (line.startsWith("> ")) {
			const buf: string[] = [];
			while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
				buf.push((lines[i] ?? "").slice(2));
				i += 1;
			}
			out.push({ kind: BlockKind.BlockQuote, text: buf.join(" ") });
			continue;
		}
		const ulMatch = line.match(/^[-*+]\s+(.+)$/);
		if (ulMatch) {
			const items: string[] = [ulMatch[1] ?? ""];
			i += 1;
			while (i < lines.length) {
				const next = lines[i] ?? "";
				const nm = next.match(/^[-*+]\s+(.+)$/);
				if (!nm) {
					const cont = next.match(/^\s{2,}(.+)$/);
					if (cont && items.length > 0) {
						items[items.length - 1] = `${items[items.length - 1] ?? ""} ${cont[1] ?? ""}`;
						i += 1;
						continue;
					}
					break;
				}
				items.push(nm[1] ?? "");
				i += 1;
			}
			out.push({ kind: BlockKind.UnorderedList, items });
			continue;
		}
		const olMatch = line.match(/^\d+\.\s+(.+)$/);
		if (olMatch) {
			const items: string[] = [olMatch[1] ?? ""];
			i += 1;
			while (i < lines.length) {
				const next = lines[i] ?? "";
				const nm = next.match(/^\d+\.\s+(.+)$/);
				if (!nm) break;
				items.push(nm[1] ?? "");
				i += 1;
			}
			out.push({ kind: BlockKind.OrderedList, items });
			continue;
		}
		const buf: string[] = [line];
		i += 1;
		while (i < lines.length) {
			const next = lines[i] ?? "";
			if (next.trim().length === 0) break;
			if (next.match(/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|```)/)) break;
			if (looksLikeTableHeader(lines, i)) break;
			buf.push(next);
			i += 1;
		}
		out.push({ kind: BlockKind.Paragraph, text: buf.join(" ") });
	}
	return out;
}

function looksLikeTableHeader(lines: readonly string[], index: number): boolean {
	const first = lines[index] ?? "";
	const second = lines[index + 1] ?? "";
	if (!first.includes("|")) return false;
	const sep = second.trim();
	if (!sep.includes("|")) return false;
	return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(sep);
}

function splitTableRow(line: string): string[] {
	let trimmed = line.trim();
	if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
	if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
	return trimmed.split("|").map((cell) => cell.trim());
}

type InlineToken =
	| { kind: "text"; text: string }
	| { kind: "bold"; text: string }
	| { kind: "em"; text: string }
	| { kind: "strike"; text: string }
	| { kind: "code"; text: string }
	| { kind: "link"; text: string; url: string };

const EXTERNAL_LINK_RE = /^(https?:|brainstorm:|mailto:|#)/;
const INTERNAL_RELATIVE_RE = /^(\.\/|\.\.\/|\/)/;

function renderInline(
	text: string,
	article: HelpArticleType,
	corpus: readonly HelpArticleType[],
): ReactNode {
	const tokens = tokeniseInline(text);
	return (
		<>
			{tokens.map((tok, i) => {
				const k = `${i}-${tok.kind}-${tok.text.slice(0, 24)}`;
				switch (tok.kind) {
					case "text":
						return <Fragment key={k}>{tok.text}</Fragment>;
					case "bold":
						return <strong key={k}>{tok.text}</strong>;
					case "em":
						return <em key={k}>{tok.text}</em>;
					case "strike":
						return <s key={k}>{tok.text}</s>;
					case "code":
						return (
							<code key={k} className="help__inline-code">
								{tok.text}
							</code>
						);
					case "link":
						return renderLink(tok, k, article, corpus);
				}
			})}
		</>
	);
}

function renderLink(
	tok: Extract<InlineToken, { kind: "link" }>,
	key: string,
	article: HelpArticleType,
	corpus: readonly HelpArticleType[],
): ReactNode {
	const trimmed = tok.url.trim();
	if (EXTERNAL_LINK_RE.test(trimmed)) {
		return (
			<a key={key} href={trimmed} className="help__link" rel="noreferrer">
				{tok.text}
			</a>
		);
	}
	if (INTERNAL_RELATIVE_RE.test(trimmed) || /\.md(#.*)?$/.test(trimmed)) {
		const targetTopicId = resolveInternalLink(article, corpus, trimmed);
		if (targetTopicId) {
			return (
				<a
					key={key}
					href={`#help/${targetTopicId}`}
					className="help__link"
					data-help-topic-id={targetTopicId}
					data-testid="help-internal-link"
				>
					{tok.text}
				</a>
			);
		}
	}
	return <Fragment key={key}>{tok.text}</Fragment>;
}

function resolveInternalLink(
	article: HelpArticleType,
	corpus: readonly HelpArticleType[],
	target: string,
): string | null {
	const hashIdx = target.indexOf("#");
	const pathPart = hashIdx === -1 ? target : target.slice(0, hashIdx);
	if (pathPart.length === 0) return article.topicId;
	const resolved = resolveRelative(article.relPath, pathPart);
	if (!resolved) return null;
	const match = corpus.find((a) => a.relPath === resolved);
	return match ? match.topicId : null;
}

function resolveRelative(fromRelPath: string, target: string): string | null {
	const baseSegments = fromRelPath.split("/").slice(0, -1);
	const targetSegments = target.split("/");
	const segments = [...baseSegments];
	for (const seg of targetSegments) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") {
			if (segments.length === 0) return null;
			segments.pop();
			continue;
		}
		segments.push(seg);
	}
	return segments.join("/");
}

function tokeniseInline(input: string): InlineToken[] {
	const tokens: InlineToken[] = [];
	let i = 0;
	let buf = "";
	const flush = () => {
		if (buf.length > 0) {
			tokens.push({ kind: "text", text: buf });
			buf = "";
		}
	};
	while (i < input.length) {
		const ch = input[i];
		if (ch === "`") {
			const end = input.indexOf("`", i + 1);
			if (end > i) {
				flush();
				tokens.push({ kind: "code", text: input.slice(i + 1, end) });
				i = end + 1;
				continue;
			}
		}
		if (ch === "[") {
			const closeBracket = input.indexOf("]", i + 1);
			if (closeBracket > i && input[closeBracket + 1] === "(") {
				const closeParen = input.indexOf(")", closeBracket + 2);
				if (closeParen > closeBracket) {
					flush();
					tokens.push({
						kind: "link",
						text: input.slice(i + 1, closeBracket),
						url: input.slice(closeBracket + 2, closeParen),
					});
					i = closeParen + 1;
					continue;
				}
			}
		}
		if (ch === "~" && input[i + 1] === "~") {
			const end = input.indexOf("~~", i + 2);
			if (end > i + 1) {
				flush();
				tokens.push({ kind: "strike", text: input.slice(i + 2, end) });
				i = end + 2;
				continue;
			}
		}
		if (ch === "*" && input[i + 1] === "*") {
			const end = input.indexOf("**", i + 2);
			if (end > i + 1) {
				flush();
				tokens.push({ kind: "bold", text: input.slice(i + 2, end) });
				i = end + 2;
				continue;
			}
		}
		if ((ch === "*" || ch === "_") && input[i + 1] !== ch) {
			const end = input.indexOf(ch, i + 1);
			if (end > i) {
				flush();
				tokens.push({ kind: "em", text: input.slice(i + 1, end) });
				i = end + 1;
				continue;
			}
		}
		buf += ch;
		i += 1;
	}
	flush();
	return tokens;
}
