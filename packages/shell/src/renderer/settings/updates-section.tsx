/**
 * 13.6 — Settings → General → "Updates" (manual-download check).
 *
 * Shows the running version, the release channel (Stable / Beta), and a
 * "Check for updates" button. A check resolves to one of three states:
 * up to date · a newer version with a Download button (opens the release
 * page through the open-resolution OS-handoff chokepoint — the shell
 * never downloads or installs in v1) · couldn't check. The channel +
 * last-checked stamp persist app-global through `window.brainstorm.update`.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
	UpdateAvailability,
	UpdateChannel,
	type UpdateCheckResult,
} from "../../shared/update-wire-types";
import { t } from "../i18n/t";
import { Button, ButtonSize, ButtonVariant } from "../ui/button";
import { SettingRow, SettingSelect } from "./settings-controls";

const CHANNEL_OPTIONS: readonly { value: UpdateChannel; labelKey: string }[] = [
	{ value: UpdateChannel.Stable, labelKey: "shell.settings.updates.channel.stable" },
	{ value: UpdateChannel.Beta, labelKey: "shell.settings.updates.channel.beta" },
];

export function UpdatesSection() {
	const channelId = useId();
	const [channel, setChannel] = useState<UpdateChannel>(UpdateChannel.Stable);
	const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
	const [result, setResult] = useState<UpdateCheckResult | null>(null);
	const [checking, setChecking] = useState(false);
	const currentVersion = window.brainstorm.version;

	useEffect(() => {
		let live = true;
		void window.brainstorm.update.getPrefs().then((prefs) => {
			if (!live) return;
			setChannel(prefs.channel);
			setLastCheckedAt(prefs.lastCheckedAt);
		});
		return () => {
			live = false;
		};
	}, []);

	const onCheck = useCallback(async () => {
		setChecking(true);
		try {
			const next = await window.brainstorm.update.check();
			setResult(next);
			setLastCheckedAt(next.checkedAt);
		} finally {
			setChecking(false);
		}
	}, []);

	const onChannelChange = useCallback((next: UpdateChannel) => {
		setChannel(next);
		// A channel change invalidates the previous result.
		setResult(null);
		void window.brainstorm.update.setChannel(next);
	}, []);

	const onDownload = useCallback((url: string) => {
		void window.brainstorm.intents.dispatch({ verb: "open", payload: { url } });
	}, []);

	return (
		<section className="settings__section">
			<h4 className="settings__section-title">{t("shell.settings.updates.title")}</h4>
			<p className="settings__section-summary">{t("shell.settings.updates.summary")}</p>

			<SettingRow
				title={t("shell.settings.updates.currentVersion")}
				control={<span className="settings__value-text">{currentVersion}</span>}
			/>

			<SettingRow
				title={t("shell.settings.updates.channel")}
				description={t("shell.settings.updates.channel.description")}
				htmlFor={channelId}
				control={
					<SettingSelect
						id={channelId}
						value={channel}
						ariaLabel={t("shell.settings.updates.channel")}
						options={CHANNEL_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
						onChange={onChannelChange}
					/>
				}
			/>

			<div className="settings__updates-actions">
				<Button
					variant={ButtonVariant.Primary}
					size={ButtonSize.Sm}
					disabled={checking}
					onClick={() => {
						void onCheck();
					}}
				>
					{checking ? t("shell.settings.updates.checking") : t("shell.settings.updates.check")}
				</Button>
				{lastCheckedAt !== null && (
					<span className="settings__updates-last">
						{t("shell.settings.updates.lastChecked", { when: formatWhen(lastCheckedAt) })}
					</span>
				)}
			</div>

			{result !== null && <UpdateResult result={result} onDownload={onDownload} />}
		</section>
	);
}

function UpdateResult({
	result,
	onDownload,
}: {
	result: UpdateCheckResult;
	onDownload: (url: string) => void;
}) {
	if (result.availability === UpdateAvailability.Available && result.latest !== undefined) {
		const latest = result.latest;
		return (
			<div className="settings__updates-result settings__updates-result--available" role="status">
				<p className="settings__updates-headline">
					{t("shell.settings.updates.available", { version: latest.version })}
				</p>
				{latest.notes !== undefined && <p className="settings__updates-notes">{latest.notes}</p>}
				<Button
					variant={ButtonVariant.Primary}
					size={ButtonSize.Sm}
					onClick={() => onDownload(latest.downloadUrl)}
				>
					{t("shell.settings.updates.download")}
				</Button>
			</div>
		);
	}
	const messageKey =
		result.availability === UpdateAvailability.UpToDate
			? "shell.settings.updates.upToDate"
			: "shell.settings.updates.unknown";
	return (
		<div className="settings__updates-result" role="status">
			<p className="settings__updates-headline">{t(messageKey)}</p>
		</div>
	);
}

function formatWhen(iso: string): string {
	try {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return iso;
		return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
			date,
		);
	} catch {
		return iso;
	}
}
