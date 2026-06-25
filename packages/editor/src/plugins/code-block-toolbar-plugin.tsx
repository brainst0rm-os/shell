/**
 * CodeBlockToolbarPlugin — hover-revealed chrome on every code block (B11.4):
 * a language picker + a Copy button, floated at the block's top-right. The
 * picker persists through `CodeNode.setLanguage`; Copy reads the element's
 * `textContent` (model-independent, survives the future Shiki swap) and
 * flashes "Copied". Event-delegated off `mousemove` so it's independent of
 * the code block's internal node model.
 *
 * Remaining B11.4: async Shiki highlighting (the decorator pipeline) +
 * word-wrap / line-number toggles.
 */

import { CodeNode, getLanguageFriendlyName } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import { $getNearestNodeFromDOMNode, $getNodeByKey, type NodeKey } from "lexical";
import { useCallback, useEffect, useRef, useState } from "react";
import { type EditorT, useEditorT } from "../i18n";
import { CopyIcon } from "../icons";
import {
	LINE_NUMBERS_EVENT,
	persistLineNumbersPref,
	readLineNumbersPref,
} from "./code-line-numbers-plugin";
import { useEditorShortcut } from "./editor-shortcut";

/** Esc closes the language overflow menu. */
const CLOSE_OVERFLOW_CHORDS = ["Escape"] as const;

const CODE_SELECTOR = ".notes__code";
const COPIED_MS = 1200;
const EDGE_GAP = 6;
const WRAP_PREF_KEY = "notes.code.wrap";
const WRAP_ROOT_CLASS = "notes--code-wrap";

/** Word-wrap is an editor-wide view preference (renderer-local, like the
 *  nav/props panel prefs) applied as a class on the contenteditable root — no
 *  per-block node state (that, and line-numbers, await the highlighting
 *  pipeline that gives each code line its own element). */
function readWrapPref(): boolean {
	try {
		return localStorage.getItem(WRAP_PREF_KEY) === "1";
	} catch {
		return false;
	}
}

function persistWrapPref(value: boolean): void {
	try {
		localStorage.setItem(WRAP_PREF_KEY, value ? "1" : "0");
	} catch {
		// localStorage unavailable (private mode / older shell) — wrap just
		// doesn't persist across reloads; the toggle still works this session.
	}
}

/** Curated language menu — the common set, named via `@lexical/code`'s own
 *  friendly-name map so the labels match the highlighter when Shiki lands.
 *  `""` is plain text (no language). */
const LANGUAGES: readonly string[] = [
	"",
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"python",
	"json",
	"html",
	"css",
	"markdown",
	"bash",
	"sql",
	"go",
	"rust",
	"java",
	"cpp",
	"yaml",
];

function languageLabel(lang: string | null | undefined, t: EditorT): string {
	if (!lang) return t("editor.code.plainText");
	return getLanguageFriendlyName(lang) || lang;
}

export function CodeBlockToolbarPlugin() {
	const [editor] = useLexicalComposerContext();
	const t = useEditorT();
	const [target, setTarget] = useState<HTMLElement | null>(null);
	const [nodeKey, setNodeKey] = useState<NodeKey | null>(null);
	const [language, setLanguage] = useState<string>("");
	const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
	const [copied, setCopied] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [wrap, setWrap] = useState(readWrapPref);
	const [lineNumbers, setLineNumbers] = useState(readLineNumbersPref);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Reflect the wrap pref onto the contenteditable root (every code block
	// inside it wraps via CSS). Runs on mount + whenever the toggle flips.
	useEffect(() => {
		const root = editor.getRootElement();
		root?.classList.toggle(WRAP_ROOT_CLASS, wrap);
	}, [editor, wrap]);

	// Track which code block the pointer is over. Staying on the floating
	// toolbar (which sits outside the contenteditable) keeps it shown.
	useEffect(() => {
		const onMove = (event: MouseEvent) => {
			const el = event.target as HTMLElement | null;
			if (!el) return;
			if (rootRef.current?.contains(el)) return;
			const code = (el.closest?.(CODE_SELECTOR) as HTMLElement | null) ?? null;
			setTarget((prev) => (prev === code ? prev : code));
		};
		document.addEventListener("mousemove", onMove);
		return () => document.removeEventListener("mousemove", onMove);
	}, []);

	// Resolve the hovered DOM element to its CodeNode + current language.
	useEffect(() => {
		if (!target) {
			setNodeKey(null);
			setMenuOpen(false);
			return;
		}
		try {
			editor.getEditorState().read(() => {
				const node = $getNearestNodeFromDOMNode(target);
				const code =
					node instanceof CodeNode
						? node
						: node
							? ($findMatchingParent(node, (n) => n instanceof CodeNode) as CodeNode | null)
							: null;
				setNodeKey(code?.getKey() ?? null);
				setLanguage(code?.getLanguage() ?? "");
			});
		} catch {
			// DOM node not resolvable to a live editor node (rare race) — the
			// toolbar still renders; the language defaults to plain text.
			setNodeKey(null);
			setLanguage("");
		}
	}, [editor, target]);

	// Position the toolbar at the hovered block's top-right, following scroll.
	useEffect(() => {
		if (!target) return;
		const update = () => {
			const rect = target.getBoundingClientRect();
			setPos({ top: rect.top + EDGE_GAP, right: window.innerWidth - rect.right + EDGE_GAP });
		};
		update();
		window.addEventListener("scroll", update, true);
		window.addEventListener("resize", update);
		return () => {
			window.removeEventListener("scroll", update, true);
			window.removeEventListener("resize", update);
		};
	}, [target]);

	useEffect(() => {
		return () => {
			if (copiedTimer.current) clearTimeout(copiedTimer.current);
		};
	}, []);

	useEditorShortcut(
		CLOSE_OVERFLOW_CHORDS,
		useCallback((event: KeyboardEvent) => {
			if (!rootRef.current) return;
			event.preventDefault();
			setMenuOpen(false);
		}, []),
	);

	const onCopy = useCallback(() => {
		const text = target?.textContent ?? "";
		void navigator.clipboard?.writeText(text).catch(() => undefined);
		setCopied(true);
		if (copiedTimer.current) clearTimeout(copiedTimer.current);
		copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
	}, [target]);

	const onPickLanguage = useCallback(
		(lang: string) => {
			if (nodeKey) {
				editor.update(() => {
					const node = $getNodeByKey(nodeKey);
					if (node instanceof CodeNode) node.setLanguage(lang);
				});
			}
			setLanguage(lang);
			setMenuOpen(false);
		},
		[editor, nodeKey],
	);

	const onToggleWrap = useCallback(() => {
		setWrap((prev) => {
			const next = !prev;
			persistWrapPref(next);
			return next;
		});
	}, []);

	const onToggleLineNumbers = useCallback(() => {
		setLineNumbers((prev) => {
			const next = !prev;
			persistLineNumbersPref(next);
			// Nudge the always-mounted gutter plugin to re-read + re-render.
			window.dispatchEvent(new Event(LINE_NUMBERS_EVENT));
			return next;
		});
	}, []);

	if (!editor || !target) return null;

	return (
		<div
			ref={rootRef}
			className="notes__code-toolbar"
			style={{ top: `${pos.top}px`, right: `${pos.right}px` }}
			// Outside the contenteditable — preventDefault keeps the selection.
			onMouseDown={(event) => event.preventDefault()}
		>
			<div className="notes__code-lang">
				<button
					type="button"
					className="notes__code-toolbar-btn"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					aria-label={t("editor.code.language")}
					title={t("editor.code.language")}
					onClick={() => setMenuOpen((open) => !open)}
				>
					{languageLabel(language, t)}
				</button>
				{menuOpen && (
					<div
						className="fm-menu notes__code-lang-menu"
						role="menu"
						aria-label={t("editor.code.language")}
					>
						<div className="fm-list" role="presentation">
							{LANGUAGES.map((lang) => (
								<button
									key={lang || "plain"}
									type="button"
									role="menuitemradio"
									aria-checked={lang === language}
									data-active={lang === language || undefined}
									className="fm-row"
									onClick={() => onPickLanguage(lang)}
								>
									<span className="fm-row__name">{languageLabel(lang, t)}</span>
								</button>
							))}
						</div>
					</div>
				)}
			</div>
			<button
				type="button"
				className="notes__code-toolbar-btn"
				aria-pressed={wrap}
				data-active={wrap || undefined}
				aria-label={t("editor.code.wrap")}
				title={t("editor.code.wrap")}
				onClick={onToggleWrap}
			>
				{t("editor.code.wrap")}
			</button>
			<button
				type="button"
				className="notes__code-toolbar-btn"
				aria-pressed={lineNumbers}
				data-active={lineNumbers || undefined}
				aria-label={t("editor.code.lineNumbers")}
				title={t("editor.code.lineNumbers")}
				onClick={onToggleLineNumbers}
			>
				{t("editor.code.lineNumbers")}
			</button>
			<button
				type="button"
				className="notes__code-toolbar-btn notes__code-copy"
				aria-label={t("editor.code.copy")}
				title={t("editor.code.copy")}
				onClick={onCopy}
			>
				<span aria-hidden="true">
					<CopyIcon />
				</span>
				<span className="notes__code-copy-label">
					{copied ? t("editor.code.copied") : t("editor.code.copy")}
				</span>
			</button>
		</div>
	);
}
