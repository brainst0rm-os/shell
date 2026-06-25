/**
 * Settings → Search index (Stage 9.22.4).
 *
 * Read + maintenance surface for the vault-wide lexical index. The index
 * is self-healing (rebuilt on every launch + after edits, per
 * `search-indexer.ts`), so this panel is diagnostic: it shows how much is
 * indexed, how that compares to the indexable entities the sources hold
 * (coverage), when it last changed, and how big it is — plus a manual
 * "Reindex now" for when a user wants to force a rebuild.
 *
 * Privileged shell surface — calls `window.brainstorm.search.{stats,
 * reindex}` directly over IPC (same trust model as the launcher palette).
 * Apps never reach this; they only `services.search.query` via the broker.
 */

import { useCallback, useEffect, useState } from "react";
import type { SearchIndexReport } from "../../preload";
import { t } from "../i18n/t";
import { ConfirmVariant, confirm } from "../ui/confirm";
import { Icon, IconName } from "../ui/icon";
import { IconButton } from "../ui/icon-button";
import { ToastKind, pushToast } from "../ui/toasts";
import { useSettingsHeaderActions } from "./header-actions";
import {
	coveragePercent,
	formatBytes,
	formatRelativeTime,
	shortTypeName,
} from "./search-section-format";

export function SearchSection() {
	const [report, setReport] = useState<SearchIndexReport | null>(null);
	const [loaded, setLoaded] = useState(false);
	const [reindexing, setReindexing] = useState(false);
	const setHeaderActions = useSettingsHeaderActions();

	useEffect(() => {
		let cancelled = false;
		void window.brainstorm.search.stats().then((next) => {
			if (cancelled) return;
			setReport(next);
			setLoaded(true);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const onReindex = useCallback(async () => {
		const ok = await confirm({
			title: t("shell.settings.search.reindexConfirm.title"),
			body: t("shell.settings.search.reindexConfirm.body"),
			confirmLabel: t("shell.settings.search.reindex"),
			confirmVariant: ConfirmVariant.Primary,
		});
		if (!ok) return;
		setReindexing(true);
		try {
			const next = await window.brainstorm.search.reindex();
			setReport(next);
			pushToast({
				kind: ToastKind.Success,
				title: t("shell.settings.search.reindexDone", {
					count: next.total.toLocaleString(),
				}),
			});
		} finally {
			setReindexing(false);
		}
	}, []);

	const unavailable = !report || (report.total === 0 && report.available === null);
	useEffect(() => {
		if (!loaded || unavailable) {
			setHeaderActions(null);
			return;
		}
		setHeaderActions(
			<IconButton
				icon={IconName.Update}
				label={reindexing ? t("shell.settings.search.reindexing") : t("shell.settings.search.reindex")}
				disabled={reindexing}
				onClick={() => {
					void onReindex();
				}}
				data-testid="settings-search-reindex"
			/>,
		);
		return () => {
			setHeaderActions(null);
		};
	}, [loaded, unavailable, reindexing, onReindex, setHeaderActions]);

	if (!loaded) {
		return (
			<section className="settings__section">
				<p className="settings__placeholder">{t("shell.settings.search.loading")}</p>
			</section>
		);
	}

	// No active vault session: the indexer is null (total 0) AND the source
	// scan couldn't run (available null). An empty *open* vault reports
	// available 0, not null — so this only fires when there's nothing to show.
	if (unavailable || !report) {
		return (
			<section className="settings__section">
				<p className="settings__section-summary">{t("shell.settings.search.summary")}</p>
				<p className="settings__placeholder">{t("shell.settings.search.unavailable")}</p>
			</section>
		);
	}

	const coverage = coveragePercent(report.total, report.available);
	const lastIndexed = formatRelativeTime(report.lastIndexedAt);
	const maxTypeCount = report.byType.reduce((m, r) => Math.max(m, r.count), 0);

	return (
		<section className="settings__section">
			<p className="settings__section-summary">{t("shell.settings.search.summary")}</p>

			<div className="search-index__stats">
				<StatCard
					icon={IconName.Entity}
					label={t("shell.settings.search.stat.indexed")}
					value={report.total.toLocaleString()}
				/>
				<StatCard
					icon={IconName.Search}
					label={t("shell.settings.search.stat.coverage")}
					value={coverage === null ? t("shell.settings.search.coverage.unknown") : `${coverage}%`}
					sub={
						report.available === null
							? undefined
							: t("shell.settings.search.coverage.detail", {
									indexed: report.total.toLocaleString(),
									available: report.available.toLocaleString(),
								})
					}
				>
					{coverage !== null && (
						// Decorative — the percentage + "X of Y indexable" sub-line
						// already carry the value for assistive tech; the bar is a
						// visual echo, not a second focus stop.
						<div className="search-index__bar" aria-hidden="true">
							<span className="search-index__bar-fill" style={{ width: `${coverage}%` }} />
						</div>
					)}
				</StatCard>
				<StatCard
					icon={IconName.Update}
					label={t("shell.settings.search.stat.lastIndexed")}
					value={lastIndexed ?? t("shell.settings.search.lastIndexed.never")}
				/>
				<StatCard
					icon={IconName.Entity}
					label={t("shell.settings.search.stat.size")}
					value={formatBytes(report.bytes)}
				/>
			</div>

			<div className="search-index__bytype">
				<h4 className="settings__section-title">{t("shell.settings.search.byType.heading")}</h4>
				{report.byType.length === 0 ? (
					<p className="settings__placeholder">{t("shell.settings.search.byType.empty")}</p>
				) : (
					<ul className="search-index__bytype-list">
						{report.byType.map((row) => (
							<li key={row.type} className="search-index__bytype-row">
								<span className="search-index__bytype-name" title={row.type}>
									{shortTypeName(row.type)}
								</span>
								<span className="search-index__bytype-track" aria-hidden="true">
									<span
										className="search-index__bytype-fill"
										style={{
											width: `${maxTypeCount > 0 ? Math.round((row.count / maxTypeCount) * 100) : 0}%`,
										}}
									/>
								</span>
								<span className="search-index__bytype-count">
									{t("shell.settings.search.byType.count", {
										count: row.count.toLocaleString(),
									})}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

function StatCard({
	icon,
	label,
	value,
	sub,
	children,
}: {
	icon: IconName;
	label: string;
	value: string;
	sub?: string | undefined;
	children?: React.ReactNode;
}) {
	return (
		<div className="search-index__stat">
			<span className="search-index__stat-head">
				<span className="search-index__stat-icon" aria-hidden="true">
					<Icon name={icon} size={15} />
				</span>
				<span className="search-index__stat-label">{label}</span>
			</span>
			<span className="search-index__stat-value">{value}</span>
			{sub && <span className="search-index__stat-sub">{sub}</span>}
			{children}
		</div>
	);
}
