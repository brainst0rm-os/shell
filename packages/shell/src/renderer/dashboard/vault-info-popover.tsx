/**
 * Vault-info popover — surfaces the formerly footer-bound metadata
 * (vault folder, app version, credentials-backend warning) behind the
 * dashboard header's Info icon. Keeps the footer free for the running-
 * windows strip per the dashboard task-panel layout.
 *
 * Uses the shared `<Popover>` primitive (project rule: every overlay flows
 * through it for consistent chrome, backdrop, and dismissal behaviour).
 */

import type { VaultEntry, VaultSessionMeta } from "../../preload";
import { t } from "../i18n/t";
import { Popover } from "../ui/popover";
import { PopoverBodyPadding, PopoverSize } from "../ui/popover-types";

export type VaultInfoPopoverProps = {
	vault: VaultEntry;
	session: VaultSessionMeta | null;
	version: string;
	onClose: () => void;
};

export function VaultInfoPopover({ vault, session, version, onClose }: VaultInfoPopoverProps) {
	return (
		<Popover
			title={t("shell.dashboard.vaultInfo.title")}
			size={PopoverSize.Medium}
			bodyPadding={PopoverBodyPadding.Comfortable}
			onClose={onClose}
		>
			<dl className="vault-info">
				<dt>{t("shell.dashboard.vaultInfo.vaultName")}</dt>
				<dd>{vault.name}</dd>
				<dt>{t("shell.dashboard.vaultInfo.path")}</dt>
				<dd className="vault-info__mono">{vault.path}</dd>
				<dt>{t("shell.dashboard.vaultInfo.version")}</dt>
				<dd className="vault-info__mono">{version}</dd>
				{session && (
					<>
						<dt>{t("shell.dashboard.vaultInfo.backend")}</dt>
						<dd>{session.backendDescription}</dd>
					</>
				)}
			</dl>
			{session?.backendIsInsecure && (
				<p className="vault-info__warn">{t("shell.dashboard.vaultInfo.backendInsecure")}</p>
			)}
		</Popover>
	);
}
