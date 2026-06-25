/**
 * Settings → Apps & contributions (doc 63 / AS-4 §Security — User control).
 * Lists every installed app and, for the ones that contribute cross-app actions
 * (declared `process`/`convert`/`share`/`export`/`insert` intents that surface
 * in other apps' menus), a toggle to disable its contributions wholesale.
 * Disabling drops the app's contributions from every host menu
 * (`intents.suggestActions`) until re-enabled; the disabled set is the per-vault
 * `disabledContributors` dashboard map the intents bus reads.
 *
 * The toggle reads the *current* disabled set from the live dashboard snapshot
 * (so a change reflects without a refetch) and the installed-app list once on
 * mount. An app with no contributions is shown but its toggle is disabled +
 * explained (nothing to control).
 */

import { useEffect, useMemo, useState } from "react";
import type { InstalledApp } from "../../preload";
import { useDashboard } from "../dashboard/use-dashboard";
import { t } from "../i18n/t";
import { ToggleRow } from "./settings-controls";

export function ContributionsSection() {
	const snapshot = useDashboard();
	const [apps, setApps] = useState<InstalledApp[] | null>(null);
	const [contributors, setContributors] = useState<Set<string>>(new Set());

	useEffect(() => {
		let cancelled = false;
		void Promise.all([
			window.brainstorm.apps.listInstalled(),
			window.brainstorm.apps.listContributingApps(),
		]).then(([installed, contributing]) => {
			if (cancelled) return;
			setApps(installed);
			setContributors(new Set(contributing));
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const disabled = useMemo(
		() => new Set(snapshot?.disabledContributors ?? []),
		[snapshot?.disabledContributors],
	);

	const onToggle = (appId: string, enabled: boolean) => {
		void window.brainstorm.dashboard.setContributorDisabled(appId, !enabled);
	};

	if (apps === null) {
		return (
			<section className="settings__section">
				<p className="settings__section-summary">{t("shell.settings.contributions.summary")}</p>
				<p className="settings__placeholder">{t("shell.settings.contributions.loading")}</p>
			</section>
		);
	}

	if (apps.length === 0) {
		return (
			<section className="settings__section">
				<p className="settings__section-summary">{t("shell.settings.contributions.summary")}</p>
				<p className="settings__placeholder">{t("shell.settings.contributions.empty")}</p>
			</section>
		);
	}

	return (
		<section className="settings__section">
			<p className="settings__section-summary">{t("shell.settings.contributions.summary")}</p>
			<div className="settings__contributions-list">
				{apps.map((appEntry) => {
					const contributes = contributors.has(appEntry.id);
					const enabled = !disabled.has(appEntry.id);
					return (
						<ToggleRow
							key={appEntry.id}
							title={appEntry.name}
							description={
								contributes
									? t("shell.settings.contributions.contributes")
									: t("shell.settings.contributions.none")
							}
							ariaLabel={t("shell.settings.contributions.toggle", { app: appEntry.name })}
							checked={enabled}
							disabled={!contributes}
							onChange={(next) => onToggle(appEntry.id, next)}
						/>
					);
				})}
			</div>
		</section>
	);
}
