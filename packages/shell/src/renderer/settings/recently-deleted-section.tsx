/**
 * Settings → Recently Deleted (9.8.8) — the Bin's Settings face.
 *
 * The Bin overlay (Stage 9.19) owns the deleted-objects LIST (restore /
 * permanent delete / empty); duplicating that surface here would fork its
 * keyboard model and chrome. This section owns the POLICY half the UX doc
 * places in Settings: the retention window (soft-deleted entities purge
 * lazily once they age past it — default 30 days, "forever" disables the
 * sweep) plus a live count and the jump into the overlay.
 *
 * Retention persists per-vault via the `bin:get/set-retention` IPC
 * (settings.db, shell namespace) so every device opening the vault agrees
 * on what is still restorable.
 */

import { useCallback, useEffect, useState } from "react";
import { useBin } from "../bin/use-bin";
import { t } from "../i18n/t";
import { Button, ButtonVariant } from "../ui/button";
import { IconName } from "../ui/icon";
import { SettingRow, SettingSelect } from "./settings-controls";

/** Mirror of the main-side presets (`BIN_RETENTION_PRESETS`) — a renderer
 *  copy because the preload boundary only ferries the numbers. 0 = forever. */
const RETENTION_OPTIONS: ReadonlyArray<{ days: number; labelKey: string }> = [
	{ days: 7, labelKey: "shell.settings.recentlyDeleted.retention.days7" },
	{ days: 30, labelKey: "shell.settings.recentlyDeleted.retention.days30" },
	{ days: 90, labelKey: "shell.settings.recentlyDeleted.retention.days90" },
	{ days: 365, labelKey: "shell.settings.recentlyDeleted.retention.days365" },
	{ days: 0, labelKey: "shell.settings.recentlyDeleted.retention.forever" },
];

export type RecentlyDeletedSectionProps = {
	onOpenBin?: () => void;
};

export function RecentlyDeletedSection({ onOpenBin }: RecentlyDeletedSectionProps) {
	const { items } = useBin();
	const [retention, setRetention] = useState<number | null>(null);

	useEffect(() => {
		let live = true;
		void window.brainstorm.bin.getRetention().then((days) => {
			if (live) setRetention(days);
		});
		return () => {
			live = false;
		};
	}, []);

	const onRetentionChange = useCallback((value: string) => {
		const days = Number(value);
		setRetention(days);
		void window.brainstorm.bin.setRetention(days).then((applied) => {
			// The main side fails closed on junk — mirror whatever it kept.
			setRetention(applied);
		});
	}, []);

	const count = items?.length ?? 0;

	return (
		<section className="settings__section settings__section--recently-deleted">
			<p className="settings__section-summary">{t("shell.settings.recentlyDeleted.summary")}</p>

			<SettingRow
				title={t("shell.settings.recentlyDeleted.retention.title")}
				description={t("shell.settings.recentlyDeleted.retention.description")}
				control={
					retention === null ? null : (
						<SettingSelect
							value={String(retention)}
							options={RETENTION_OPTIONS.map((option) => ({
								value: String(option.days),
								label: t(option.labelKey),
							}))}
							onChange={onRetentionChange}
							ariaLabel={t("shell.settings.recentlyDeleted.retention.title")}
						/>
					)
				}
			/>

			<SettingRow
				title={t("shell.settings.recentlyDeleted.items.title")}
				description={t("shell.settings.recentlyDeleted.items.count", { count })}
				control={
					<Button
						variant={ButtonVariant.Glass}
						iconLeft={IconName.Trash}
						onClick={() => onOpenBin?.()}
						disabled={!onOpenBin}
					>
						{t("shell.settings.recentlyDeleted.openBin")}
					</Button>
				}
			/>
		</section>
	);
}
