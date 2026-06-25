/** Left rail: the unified-inbox + flagged smart views, then each account's
 *  real folders grouped under its address. Selection drives the message
 *  list (`FolderSelection`). */

import { Icon, IconName } from "@brainstorm/sdk/icon";
import type { ReactElement } from "react";
import { t } from "../i18n";
import {
	type AccountView,
	FolderRole,
	type FolderSelection,
	type FolderView,
} from "../types/mail-view";

const ROLE_ICON: Record<FolderRole, IconName> = {
	[FolderRole.Inbox]: IconName.Inbox,
	[FolderRole.Sent]: IconName.KindEmail,
	[FolderRole.Drafts]: IconName.Pencil,
	[FolderRole.Archive]: IconName.Archive,
	[FolderRole.Trash]: IconName.Trash,
	[FolderRole.Spam]: IconName.Warning,
	[FolderRole.Custom]: IconName.Folder,
};

const ROLE_LABEL: Partial<Record<FolderRole, () => string>> = {
	[FolderRole.Sent]: () => t("folders.sent"),
	[FolderRole.Drafts]: () => t("folders.drafts"),
	[FolderRole.Archive]: () => t("folders.archive"),
	[FolderRole.Trash]: () => t("folders.trash"),
	[FolderRole.Spam]: () => t("folders.spam"),
};

function folderLabel(folder: FolderView): string {
	const named = ROLE_LABEL[folder.role];
	return named ? named() : folder.path;
}

function selectionMatches(a: FolderSelection, b: FolderSelection): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === "folder" && b.kind === "folder") return a.folderId === b.folderId;
	return true;
}

type RailItemProps = {
	icon: IconName;
	label: string;
	unread?: number;
	active: boolean;
	onSelect: () => void;
};

function RailItem({ icon, label, unread, active, onSelect }: RailItemProps): ReactElement {
	return (
		<button
			type="button"
			className={`mb-rail__item${active ? " is-active" : ""}`}
			aria-current={active ? "true" : undefined}
			onClick={onSelect}
		>
			<Icon name={icon} className="mb-rail__icon" />
			<span className="mb-rail__label">{label}</span>
			{unread && unread > 0 ? (
				<span className="mb-rail__badge" aria-label={t("folders.unreadAria", { count: unread })}>
					{unread}
				</span>
			) : null}
		</button>
	);
}

export type FolderRailProps = {
	accounts: AccountView[];
	folders: FolderView[];
	selection: FolderSelection;
	unifiedUnread: number;
	onSelect: (selection: FolderSelection) => void;
};

export function FolderRail({
	accounts,
	folders,
	selection,
	unifiedUnread,
	onSelect,
}: FolderRailProps): ReactElement {
	// Real folders that are not inbox-role (inbox is the unified smart view).
	const nonInbox = folders.filter((f) => f.role !== FolderRole.Inbox);
	const byAccount = new Map<string, FolderView[]>();
	for (const f of nonInbox) {
		const list = byAccount.get(f.accountRef) ?? [];
		list.push(f);
		byAccount.set(f.accountRef, list);
	}

	return (
		<nav className="mb-rail" id="mb-rail" aria-label={t("folders.aria")}>
			<div className="mb-rail__group">
				<RailItem
					icon={IconName.Inbox}
					label={t("folders.unified")}
					unread={unifiedUnread}
					active={selectionMatches(selection, { kind: "unified-inbox" })}
					onSelect={() => onSelect({ kind: "unified-inbox" })}
				/>
				<RailItem
					icon={IconName.Star}
					label={t("folders.flagged")}
					active={selectionMatches(selection, { kind: "flagged" })}
					onSelect={() => onSelect({ kind: "flagged" })}
				/>
			</div>
			{accounts.map((account) => {
				const accountFolders = byAccount.get(account.id) ?? [];
				if (accountFolders.length === 0) return null;
				return (
					<div className="mb-rail__group" key={account.id}>
						<div className="mb-rail__heading">{account.displayName}</div>
						{accountFolders.map((folder) => (
							<RailItem
								key={folder.id}
								icon={ROLE_ICON[folder.role]}
								label={folderLabel(folder)}
								unread={folder.unreadCount}
								active={selectionMatches(selection, { kind: "folder", folderId: folder.id })}
								onSelect={() => onSelect({ kind: "folder", folderId: folder.id })}
							/>
						))}
					</div>
				);
			})}
		</nav>
	);
}
