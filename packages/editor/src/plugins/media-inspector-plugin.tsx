/**
 * MediaInspectorPlugin — popover that lets the user edit alt / caption /
 * alignment / width on an image or video block. Opens when the figure is
 * clicked (driven by `mediaInspectorStore`); closes on `Escape`, outside
 * mousedown, or when the targeted node is removed.
 *
 * Mutations route through the editor's writable getters
 * (`node.setAlt(...)`, `setCaption`, `setAlignment`, `setWidthPercent`,
 * `node.remove()`); autosave picks them up on the next editor tick.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey } from "lexical";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type EditorI18nKey, useEditorT } from "../i18n";
import {
	type InspectorTarget,
	MediaKind,
	mediaInspectorStore,
	useMediaInspector,
} from "../media-inspector-store";
import { MAX_MEDIA_WIDTH_PERCENT, MIN_MEDIA_WIDTH_PERCENT, MediaAlignment } from "../media-types";
import { $isImageBlockNode } from "../nodes/image-block-node";
import { $isVideoBlockNode } from "../nodes/video-block-node";
import { useEditorShortcut } from "./editor-shortcut";

const POPOVER_WIDTH = 280;
const POPOVER_GUTTER = 8;
const WIDTH_PRESETS = [25, 50, 75, 100] as const;

const DISCRETE = { discrete: true } as const;

type FigureSnapshot = {
	alt: string;
	caption: string;
	alignment: MediaAlignment;
	widthPercent: number;
};

export function MediaInspectorPlugin() {
	const [editor] = useLexicalComposerContext();
	const target = useMediaInspector();

	useEffect(() => {
		if (!target) return;
		// Auto-close when the targeted node is removed from the editor (e.g.
		// the user deletes it via the gutter / Backspace selection).
		const unregister = editor.registerUpdateListener(({ editorState }) => {
			editorState.read(() => {
				const node = $getNodeByKey(target.nodeKey);
				if (!node) mediaInspectorStore.close();
			});
		});
		return unregister;
	}, [editor, target]);

	if (!target) return null;

	return <InspectorPopover key={target.nodeKey} target={target} editor={editorAccessor(editor)} />;
}

type EditorAccessor = ReturnType<typeof editorAccessor>;

function editorAccessor(editor: ReturnType<typeof useLexicalComposerContext>[0]) {
	return {
		read<T>(fn: () => T): T | null {
			let value: T | null = null;
			editor.read(() => {
				value = fn();
			});
			return value;
		},
		update(fn: () => void): void {
			editor.update(fn, DISCRETE);
		},
	};
}

function InspectorPopover({
	target,
	editor,
}: {
	target: InspectorTarget;
	editor: EditorAccessor;
}) {
	const t = useEditorT();
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const [style, setStyle] = useState<{ top: number; left: number }>(() =>
		positionFor(target.anchor),
	);
	const [snapshot, setSnapshot] = useState<FigureSnapshot | null>(() =>
		readSnapshot(editor, target),
	);

	useLayoutEffect(() => {
		setStyle(positionFor(target.anchor));
	}, [target.anchor]);

	useEffect(() => {
		const next = readSnapshot(editor, target);
		setSnapshot(next);
		// Snapshot reflects what's actually in the document — if the node
		// disappeared (e.g. after a paste round-trip stripped it), close.
		if (!next) mediaInspectorStore.close();
	}, [editor, target]);

	const close = useCallback(() => {
		mediaInspectorStore.close();
	}, []);

	useEditorShortcut(
		["Escape"],
		useCallback(
			(event: KeyboardEvent) => {
				event.preventDefault();
				close();
			},
			[close],
		),
	);

	useEffect(() => {
		function onMouseDown(event: MouseEvent) {
			if (!(event.target instanceof Node)) return;
			if (popoverRef.current?.contains(event.target)) return;
			// The figure itself stays a valid mousedown target — clicking
			// the same figure re-anchors rather than closing.
			if (event.target instanceof Element) {
				const figure = event.target.closest("figure");
				if (figure?.contains(event.target)) return;
			}
			close();
		}
		document.addEventListener("mousedown", onMouseDown, true);
		return () => document.removeEventListener("mousedown", onMouseDown, true);
	}, [close]);

	if (!snapshot) return null;

	function mutate(fn: (snap: FigureSnapshot) => FigureSnapshot, apply: () => void): void {
		setSnapshot((prev) => (prev ? fn(prev) : prev));
		editor.update(apply);
	}

	function onAltChange(value: string) {
		mutate(
			(s) => ({ ...s, alt: value }),
			() => {
				const node = $getNodeByKey(target.nodeKey);
				if ($isImageBlockNode(node)) node.setAlt(value);
			},
		);
	}

	function onCaptionChange(value: string) {
		mutate(
			(s) => ({ ...s, caption: value }),
			() => {
				const node = $getNodeByKey(target.nodeKey);
				if ($isImageBlockNode(node) || $isVideoBlockNode(node)) node.setCaption(value);
			},
		);
	}

	function onAlignmentChange(value: MediaAlignment) {
		mutate(
			(s) => ({ ...s, alignment: value }),
			() => {
				const node = $getNodeByKey(target.nodeKey);
				if ($isImageBlockNode(node) || $isVideoBlockNode(node)) node.setAlignment(value);
			},
		);
	}

	function onWidthChange(value: number) {
		mutate(
			(s) => ({ ...s, widthPercent: value }),
			() => {
				const node = $getNodeByKey(target.nodeKey);
				if ($isImageBlockNode(node) || $isVideoBlockNode(node)) node.setWidthPercent(value);
			},
		);
	}

	function onDelete() {
		editor.update(() => {
			const node = $getNodeByKey(target.nodeKey);
			if (node) node.remove();
		});
		close();
	}

	const isImage = target.kind === MediaKind.Image;

	return (
		<div
			ref={popoverRef}
			className="notes__media-inspector"
			role="dialog"
			aria-label={t("editor.media.inspector.region")}
			style={{ top: `${style.top}px`, left: `${style.left}px`, width: `${POPOVER_WIDTH}px` }}
		>
			{isImage && (
				<label className="notes__media-inspector-field">
					<span className="notes__media-inspector-label">{t("editor.media.inspector.altLabel")}</span>
					<input
						type="text"
						className="notes__media-inspector-input"
						value={snapshot.alt}
						onChange={(e) => onAltChange(e.target.value)}
						placeholder={t("editor.media.inspector.altPlaceholder")}
					/>
				</label>
			)}
			<label className="notes__media-inspector-field">
				<span className="notes__media-inspector-label">{t("editor.media.inspector.captionLabel")}</span>
				<input
					type="text"
					className="notes__media-inspector-input"
					value={snapshot.caption}
					onChange={(e) => onCaptionChange(e.target.value)}
					placeholder={t("editor.media.inspector.captionPlaceholder")}
				/>
			</label>
			<fieldset className="notes__media-inspector-field">
				<legend className="notes__media-inspector-label">
					{t("editor.media.inspector.alignmentLabel")}
				</legend>
				<div className="notes__media-inspector-segmented" role="radiogroup">
					{ALIGNMENT_OPTIONS.map((opt) => (
						<button
							key={opt.value}
							type="button"
							role="radio"
							aria-checked={snapshot.alignment === opt.value}
							className={
								snapshot.alignment === opt.value
									? "notes__media-inspector-segment notes__media-inspector-segment--active"
									: "notes__media-inspector-segment"
							}
							onClick={() => onAlignmentChange(opt.value)}
						>
							{t(opt.labelKey)}
						</button>
					))}
				</div>
			</fieldset>
			<label className="notes__media-inspector-field">
				<span className="notes__media-inspector-label">
					{t("editor.media.inspector.widthLabel")}{" "}
					<span className="notes__media-inspector-value">{snapshot.widthPercent}%</span>
				</span>
				<input
					type="range"
					min={MIN_MEDIA_WIDTH_PERCENT}
					max={MAX_MEDIA_WIDTH_PERCENT}
					step={5}
					value={snapshot.widthPercent}
					onChange={(e) => onWidthChange(Number(e.target.value))}
					className="notes__media-inspector-range"
				/>
				<div className="notes__media-inspector-presets">
					{WIDTH_PRESETS.map((preset) => (
						<button
							key={preset}
							type="button"
							className={
								snapshot.widthPercent === preset
									? "notes__media-inspector-preset notes__media-inspector-preset--active"
									: "notes__media-inspector-preset"
							}
							onClick={() => onWidthChange(preset)}
						>
							{preset}%
						</button>
					))}
				</div>
			</label>
			<div className="notes__media-inspector-actions">
				<button
					type="button"
					className="notes__media-inspector-button notes__media-inspector-button--destructive"
					onClick={onDelete}
				>
					{t("editor.media.inspector.delete")}
				</button>
				<button type="button" className="notes__media-inspector-button" onClick={close}>
					{t("editor.media.inspector.close")}
				</button>
			</div>
		</div>
	);
}

const ALIGNMENT_OPTIONS: ReadonlyArray<{ value: MediaAlignment; labelKey: EditorI18nKey }> = [
	{ value: MediaAlignment.Left, labelKey: "editor.media.inspector.align.left" },
	{ value: MediaAlignment.Center, labelKey: "editor.media.inspector.align.center" },
	{ value: MediaAlignment.Right, labelKey: "editor.media.inspector.align.right" },
	{ value: MediaAlignment.Wide, labelKey: "editor.media.inspector.align.wide" },
];

function positionFor(anchor: DOMRect): { top: number; left: number } {
	const viewportW = typeof window !== "undefined" ? window.innerWidth : 1024;
	const viewportH = typeof window !== "undefined" ? window.innerHeight : 768;
	const left = Math.min(
		Math.max(POPOVER_GUTTER, anchor.right - POPOVER_WIDTH),
		viewportW - POPOVER_WIDTH - POPOVER_GUTTER,
	);
	const desiredTop = anchor.bottom + POPOVER_GUTTER;
	// If the popover would overflow the viewport, stack it above the figure.
	const top = desiredTop + 320 > viewportH ? Math.max(POPOVER_GUTTER, anchor.top - 320) : desiredTop;
	return { top, left };
}

function readSnapshot(editor: EditorAccessor, target: InspectorTarget): FigureSnapshot | null {
	return editor.read(() => {
		const node = $getNodeByKey(target.nodeKey);
		if ($isImageBlockNode(node)) {
			return {
				alt: node.getAlt(),
				caption: node.getCaption(),
				alignment: node.getAlignment(),
				widthPercent: node.getWidthPercent(),
			};
		}
		if ($isVideoBlockNode(node)) {
			return {
				alt: "",
				caption: node.getCaption(),
				alignment: node.getAlignment(),
				widthPercent: node.getWidthPercent(),
			};
		}
		return null;
	});
}
