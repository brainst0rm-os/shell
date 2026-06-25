/**
 * BacklinksPlugin — a collapsible "Linked references" section rendered
 * below the document. Lists every entity that mentions/links the open
 * note; each row is an `<a href="brainstorm://entity/<id>">` opened
 * through the shared `dispatchOpenEntity` intent. Derived (not authored)
 * content, so it lives *outside* the Lexical document — which also means
 * the editor-root click interceptor never sees these clicks (it's bound
 * to the contenteditable). The row therefore handles its own click:
 * preventDefault + dispatch, so the link never escapes to a raw
 * `brainstorm://entity/...` GET (which 404s at the protocol handler).
 * The `href` stays for accessibility / copy-link / middle-click.
 */

import type { MouseEvent } from "react";
import { useState, useSyncExternalStore } from "react";
import { t } from "../i18n/t";
import {
	entitiesSnapshotList,
	entityTitlesSnapshot,
	subscribeEntityTitles,
} from "../store/entity-title-index";
import { computeBacklinks } from "./backlinks";
import { dispatchOpenEntity } from "./open-entity-dispatch";

/** Modifier-held clicks (Cmd / Ctrl / Shift / Alt / middle button) pass
 *  through to the browser's default link behaviour — mirrors the
 *  editor-root interceptor's power-user escape hatch. */
function onBacklinkClick(event: MouseEvent<HTMLAnchorElement>, id: string, type: string): void {
	if (event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
		return;
	}
	event.preventDefault();
	dispatchOpenEntity({ entityId: id, entityType: type });
}

export function BacklinksPlugin({ currentNoteId }: { currentNoteId: string }) {
	useSyncExternalStore(subscribeEntityTitles, entityTitlesSnapshot);
	const [open, setOpen] = useState(true);
	const backlinks = computeBacklinks(entitiesSnapshotList(), currentNoteId);
	if (backlinks.length === 0) return null;

	return (
		<section className="notes__backlinks" aria-label={t("notes.backlinks.region")}>
			<button
				type="button"
				className="notes__backlinks-header"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<span className="notes__backlinks-caret" data-open={open} aria-hidden="true" />
				{t("notes.backlinks.title")}
				<span className="notes__backlinks-count">{backlinks.length}</span>
			</button>
			{open && (
				<ul className="notes__backlinks-list">
					{backlinks.map((b) => (
						<li key={b.id}>
							<a
								className="notes__backlinks-item"
								href={`brainstorm://entity/${b.id}`}
								data-entity-id={b.id}
								data-entity-type={b.type}
								onClick={(event) => onBacklinkClick(event, b.id, b.type)}
							>
								{b.title || t("notes.backlinks.untitled")}
							</a>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
