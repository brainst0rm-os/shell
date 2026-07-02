/**
 * Nothing-selected detail pane — the shared `<EmptyState>` (per
 * [[extract-to-sdk-at-copy-two]]: no bespoke placeholder chrome) with a
 * "New contact" CTA wired to the same compose popover as the header + list
 * empties, so the empty pane is actionable like Chat / Mailbox / Books. The
 * hint adapts when the contact list panel is hidden — "choose from the list"
 * is a dead instruction with no list on screen.
 */

import { EmptyState } from "@brainstorm/sdk/empty-state";
import { IconName } from "@brainstorm/sdk/icon";
import type { ReactElement } from "react";
import { t } from "../i18n";

export function NoSelection({
	listOpen,
	onCreate,
}: {
	listOpen: boolean;
	onCreate: () => void;
}): ReactElement {
	return (
		<EmptyState
			icon={IconName.Entity}
			title={t("placeholder.title")}
			hint={t(listOpen ? "placeholder.blurb" : "placeholder.blurb.listHidden")}
			action={
				<button
					type="button"
					className="bs-btn"
					data-bs-primary=""
					data-testid="contacts-placeholder-new"
					onClick={onCreate}
				>
					{t("list.new")}
				</button>
			}
		/>
	);
}
