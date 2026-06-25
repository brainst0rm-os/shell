/**
 * ToggleNode — a collapsible block container. Its FIRST child is the
 * always-visible summary line (a paragraph; the heading variants style
 * it larger); the remaining children are the collapsible body.
 *
 * Collapsed/expanded is **per-device chrome, not entity content** (B11.5):
 * if you collapse a toggle on your laptop it must not collapse for a
 * collaborator, so the state does NOT live on the node / in the synced
 * body. Instead each node carries a persisted, cross-device-stable
 * `__bsId` (the narrow block-id foundation) and `TogglePlugin` maps
 * renderer-local collapsed state to that id (localStorage, per doc). The
 * DOM defaults to open; the plugin applies the stored state.
 *
 * Hiding is purely presentational (CSS `data-open="false"` hides every
 * child but the first) — the body nodes stay in the tree so the shell's
 * reference walker still sees mentions inside a closed toggle.
 *
 * One node covers both "toggle list" and "toggle heading" via
 * `__variant`; there is no separate toggle-heading node (DRY).
 */

import {
	type EditorConfig,
	ElementNode,
	type LexicalNode,
	type SerializedElementNode,
} from "lexical";
import { mintBlockId } from "../block-id";
import { ToggleVariant } from "../block-types";

export const TOGGLE_NODE_TYPE = "toggle";
const TOGGLE_NODE_VERSION = 1 as const;

/** The DOM attribute the plugin reads to map a toggle element back to its
 *  persisted id (distinct from `data-bs-block`, which is the session-scoped
 *  virtualization id). */
export const TOGGLE_ID_ATTR = "data-bs-toggle";

export type SerializedToggleNode = SerializedElementNode & {
	type: typeof TOGGLE_NODE_TYPE;
	version: typeof TOGGLE_NODE_VERSION;
	variant: ToggleVariant;
	bsId: string;
};

const KNOWN_VARIANTS = new Set<string>(Object.values(ToggleVariant));

function coerceVariant(raw: unknown): ToggleVariant {
	return typeof raw === "string" && KNOWN_VARIANTS.has(raw)
		? (raw as ToggleVariant)
		: ToggleVariant.Paragraph;
}

export class ToggleNode extends ElementNode {
	__variant: ToggleVariant;
	__bsId: string;

	static override getType(): string {
		return TOGGLE_NODE_TYPE;
	}

	static override clone(node: ToggleNode): ToggleNode {
		return new ToggleNode(node.__variant, node.__bsId, node.__key);
	}

	constructor(variant: ToggleVariant = ToggleVariant.Paragraph, bsId?: string, key?: string) {
		super(key);
		this.__variant = variant;
		this.__bsId = bsId && bsId.length > 0 ? bsId : mintBlockId();
	}

	getBlockId(): string {
		return this.getLatest().__bsId;
	}

	getVariant(): ToggleVariant {
		return this.getLatest().__variant;
	}

	setVariant(variant: ToggleVariant): void {
		this.getWritable().__variant = variant;
	}

	override createDOM(_config: EditorConfig): HTMLElement {
		const dom = document.createElement("div");
		dom.classList.add("notes__toggle", `notes__toggle--${this.__variant}`);
		dom.setAttribute(TOGGLE_ID_ATTR, this.__bsId);
		// Default expanded; per-device collapsed state is applied by the plugin.
		dom.dataset.open = "true";
		return dom;
	}

	override updateDOM(prev: ToggleNode, dom: HTMLElement): boolean {
		if (prev.__variant !== this.__variant) {
			dom.classList.remove(`notes__toggle--${prev.__variant}`);
			dom.classList.add(`notes__toggle--${this.__variant}`);
		}
		if (prev.__bsId !== this.__bsId) dom.setAttribute(TOGGLE_ID_ATTR, this.__bsId);
		return false;
	}

	static override importJSON(serialized: SerializedToggleNode): ToggleNode {
		const bsId = typeof serialized.bsId === "string" ? serialized.bsId : undefined;
		return $createToggleNode(coerceVariant(serialized.variant), bsId);
	}

	override exportJSON(): SerializedToggleNode {
		return {
			...super.exportJSON(),
			type: TOGGLE_NODE_TYPE,
			version: TOGGLE_NODE_VERSION,
			variant: this.__variant,
			bsId: this.__bsId,
		};
	}

	/** Block container: it can hold paragraphs/lists/etc., is itself a
	 *  top-level block, and must never auto-collapse to an inline. */
	override canBeEmpty(): boolean {
		return false;
	}

	override canIndent(): boolean {
		return false;
	}
}

export function $createToggleNode(
	variant: ToggleVariant = ToggleVariant.Paragraph,
	bsId?: string,
): ToggleNode {
	return new ToggleNode(variant, bsId);
}

export function $isToggleNode(node?: LexicalNode | null): node is ToggleNode {
	return node instanceof ToggleNode;
}
