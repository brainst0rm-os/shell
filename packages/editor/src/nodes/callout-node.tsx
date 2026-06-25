/**
 * CalloutNode — an emphasis box (info / success / warn / danger / neutral)
 * holding inline content, in the same family as Quote.
 *
 * Subclass of `ParagraphNode` (same approach as `TitleNode`) so it
 * inherits paragraph editing — inline marks, mentions, links, soft line
 * breaks (Shift+Enter for multi-line). The differences:
 *   - Renders as `<div class="notes__callout notes__callout--<tone>">`.
 *   - Carries a `tone` discriminator (enum, never a raw string) that the
 *     turn-into / future tone-switcher set.
 *   - Enter behaves like Quote here (inherited `insertNewAfter` returns a
 *     ParagraphNode → exits the callout); Shift+Enter keeps writing
 *     inside it.
 *
 * Persisted shape (`type: "callout"`, `tone`) is part of the body's
 * `SerializedEditorState`. The shell's generic reference walker traverses
 * children, so mentions inside a callout still surface as `VaultLink`s.
 */

import {
	$applyNodeReplacement,
	type EditorConfig,
	type LexicalNode,
	ParagraphNode as LexicalParagraphNode,
	type SerializedParagraphNode,
} from "lexical";
import { CalloutTone } from "../block-types";

export const CALLOUT_NODE_TYPE = "callout";
const CALLOUT_NODE_VERSION = 1 as const;

export type SerializedCalloutNode = SerializedParagraphNode & {
	type: typeof CALLOUT_NODE_TYPE;
	version: typeof CALLOUT_NODE_VERSION;
	tone: CalloutTone;
};

const KNOWN_TONES = new Set<string>(Object.values(CalloutTone));

function coerceTone(raw: unknown): CalloutTone {
	return typeof raw === "string" && KNOWN_TONES.has(raw)
		? (raw as CalloutTone)
		: CalloutTone.Neutral;
}

export class CalloutNode extends LexicalParagraphNode {
	__tone: CalloutTone;

	static override getType(): string {
		return CALLOUT_NODE_TYPE;
	}

	static override clone(node: CalloutNode): CalloutNode {
		const next = new CalloutNode(node.__tone, node.__key);
		return next;
	}

	constructor(tone: CalloutTone = CalloutTone.Neutral, key?: string) {
		super(key);
		this.__tone = tone;
	}

	getTone(): CalloutTone {
		return this.getLatest().__tone;
	}

	setTone(tone: CalloutTone): void {
		this.getWritable().__tone = tone;
	}

	override createDOM(config: EditorConfig): HTMLElement {
		const dom = document.createElement("div");
		dom.classList.add("notes__callout", `notes__callout--${this.__tone}`);
		const dir = this.getDirection();
		if (dir) dom.dir = dir;
		return dom;
	}

	override updateDOM(prev: CalloutNode, dom: HTMLElement, _config: EditorConfig): boolean {
		if (prev.__tone !== this.__tone) {
			dom.classList.remove(`notes__callout--${prev.__tone}`);
			dom.classList.add(`notes__callout--${this.__tone}`);
		}
		return false;
	}

	static override importJSON(serialized: SerializedCalloutNode): CalloutNode {
		const node = $createCalloutNode(coerceTone(serialized.tone));
		node.setFormat(serialized.format);
		node.setIndent(serialized.indent);
		node.setDirection(serialized.direction);
		node.setTextFormat(serialized.textFormat);
		node.setTextStyle(serialized.textStyle);
		return node;
	}

	override exportJSON(): SerializedCalloutNode {
		return {
			...super.exportJSON(),
			type: CALLOUT_NODE_TYPE,
			version: CALLOUT_NODE_VERSION,
			tone: this.__tone,
		};
	}
}

export function $createCalloutNode(tone: CalloutTone = CalloutTone.Neutral): CalloutNode {
	return $applyNodeReplacement(new CalloutNode(tone));
}

export function $isCalloutNode(node?: LexicalNode | null): node is CalloutNode {
	return node instanceof CalloutNode;
}
