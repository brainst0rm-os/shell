/**
 * `<AttachContextButton>` — the discovery affordance for the composer context
 * rail: a small "+" button in the composer that opens a shared context menu of
 * the ways to add context (mention/link a document or person, upload media), for
 * users who don't know to type `@`. The inline `@` typeahead is the fast path;
 * this is the visible one. The menu itself is the shared fancy-menus runtime (no
 * bespoke chrome).
 */

import type { ReactElement } from "react";
import { useRef } from "react";
import { Icon, IconName } from "../icon";
import { type ContextMenuItem, openContextMenu } from "../menus";

export type AttachContextButtonLabels = {
	/** Tooltip + aria-label for the button itself. */
	button: string;
	/** "Mention…" row — opens the inline `@` typeahead. */
	mention: string;
	/** "Link a document…" row (omitted when `onLinkDocument` is absent). Kept
	 *  separate from `mention` so a host can scope `@` to people and offer
	 *  document/object pinning as its own affordance. */
	linkDocument?: string;
	/** "Upload media…" row (omitted when `onUploadMedia` is absent). */
	upload: string;
};

export type AttachContextButtonProps = {
	/** Open the inline `@` typeahead (wire to the mention hook's `trigger`). */
	onMention: () => void;
	/** Pin a document / object. Receives this button as the anchor so the host
	 *  can drop a search picker from it. Omit to hide the row. */
	onLinkDocument?: (anchor: Element) => void;
	/** Pick + upload media. Omit to hide the media row (host without upload). */
	onUploadMedia?: () => void;
	labels: AttachContextButtonLabels;
	disabled?: boolean;
};

export function AttachContextButton({
	onMention,
	onLinkDocument,
	onUploadMedia,
	labels,
	disabled,
}: AttachContextButtonProps): ReactElement {
	const ref = useRef<HTMLButtonElement | null>(null);

	const openMenu = () => {
		const el = ref.current;
		if (!el) return;
		const rect = el.getBoundingClientRect();
		const items: ContextMenuItem[] = [
			{ id: "mention", label: labels.mention, onSelect: onMention },
			...(onLinkDocument && labels.linkDocument
				? [{ id: "link", label: labels.linkDocument, onSelect: () => onLinkDocument(el) }]
				: []),
			...(onUploadMedia ? [{ id: "upload", label: labels.upload, onSelect: onUploadMedia }] : []),
		];
		openContextMenu({ x: rect.left, y: rect.bottom }, items, {
			menuLabel: labels.button,
			anchor: el,
		});
	};

	return (
		<button
			ref={ref}
			type="button"
			className="bs-composer-context__attach"
			aria-label={labels.button}
			data-bs-tooltip={labels.button}
			disabled={disabled === true}
			onClick={openMenu}
		>
			<Icon name={IconName.Plus} size={16} />
		</button>
	);
}
