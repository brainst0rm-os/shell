/**
 * `<DevicesList>` — pure render of `SignedAddDeviceRecord[]` (10.5b).
 *
 * One row per paired device: icon + label + paired-at date + per-row
 * Revoke (icon-only IconButton, dim-visible per the minimalist chrome
 * memory entry). Revoking goes through the shared `<Popover>`-derived
 * `confirm()` dialog before the IPC call lands.
 *
 * Rows are sorted newest-first by `addedAt`. Revoked records carry a
 * "Revoked" badge and a stamped row class so the surface remains
 * historical without losing audit evidence.
 */

import { useMemo } from "react";
import type { SignedAddDeviceRecord } from "../../preload";
import { t } from "../i18n/t";
import { Icon, IconName } from "../ui/icon";
import { IconButton } from "../ui/icon-button";

export type DevicesListProps = {
	records: readonly SignedAddDeviceRecord[];
	thisDeviceEd25519Pub: string | null;
	onRevoke: (record: SignedAddDeviceRecord) => void;
};

function formatPairedDate(addedAt: number): string {
	try {
		const date = new Date(addedAt);
		if (Number.isNaN(date.getTime())) return String(addedAt);
		return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
	} catch {
		return String(addedAt);
	}
}

function rowDomId(record: SignedAddDeviceRecord): string {
	return `device-row-${record.deviceEd25519Pub.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`;
}

export function sortDevices(
	records: readonly SignedAddDeviceRecord[],
): readonly SignedAddDeviceRecord[] {
	return [...records].sort((a, b) => b.addedAt - a.addedAt);
}

export function DevicesList({ records, thisDeviceEd25519Pub, onRevoke }: DevicesListProps) {
	const sorted = useMemo(() => sortDevices(records), [records]);
	if (sorted.length === 0) return null;
	return (
		<ul className="devices-list" data-testid="devices-list">
			{sorted.map((record) => {
				const label = record.deviceLabel || t("shell.settings.devices.unlabeled");
				const isThis = record.deviceEd25519Pub === thisDeviceEd25519Pub;
				const isRevoked = record.revokedAt !== undefined;
				const classes = ["devices-list__row"];
				if (isRevoked) classes.push("devices-list__row--revoked");
				return (
					<li key={record.deviceEd25519Pub} className={classes.join(" ")} id={rowDomId(record)}>
						<span className="devices-list__icon" aria-hidden="true">
							<Icon name={IconName.DeviceMobile} size={20} />
						</span>
						<span className="devices-list__text">
							<span className="devices-list__name" title={label}>
								{label}
								{isThis && (
									<span className="devices-list__badge">{t("shell.settings.devices.thisDevice")}</span>
								)}
								{isRevoked && (
									<span className="devices-list__badge devices-list__badge--revoked">
										{t("shell.settings.devices.revokedBadge")}
									</span>
								)}
							</span>
							<span className="devices-list__meta" title={record.deviceEd25519Pub}>
								{t("shell.settings.devices.pairedAt", { date: formatPairedDate(record.addedAt) })}
							</span>
						</span>
						{!isRevoked && !isThis && (
							<IconButton
								icon={IconName.Trash}
								label={t("shell.settings.devices.revokeAria", { deviceLabel: label })}
								onClick={() => onRevoke(record)}
								className="devices-list__revoke"
								data-testid={`devices-list-revoke-${record.deviceEd25519Pub.slice(0, 6)}`}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}
