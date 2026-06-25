/**
 * Sources panel per §The Marketplace surface.
 * v1 only the built-in source is listed; future iterations let the user
 * subscribe to additional remote catalogs (§Distribution channels).
 */

import type { MarketplaceSource } from "../../preload/marketplace-types";
import { t } from "../i18n/t";
import { Icon, IconName } from "../ui/icon";

export type SourcesPanelProps = {
	sources: readonly MarketplaceSource[];
	loading: boolean;
};

export function SourcesPanel({ sources, loading }: SourcesPanelProps) {
	if (loading) {
		return <p className="marketplace__loading">{t("shell.common.loading")}</p>;
	}
	return (
		<div className="marketplace__sources">
			<p className="marketplace__section-summary">{t("shell.marketplace.sources.summary")}</p>
			<ul className="marketplace__sources-list">
				{sources.map((source) => (
					<li key={source.id} className="marketplace__sources-row">
						<span className="marketplace__sources-icon" aria-hidden="true">
							<Icon name={IconName.Storefront} size={18} />
						</span>
						<div className="marketplace__sources-meta">
							<span className="marketplace__sources-name">{source.name}</span>
							<span className="marketplace__sources-kind">
								{source.builtIn
									? t("shell.marketplace.sources.builtIn")
									: t("shell.marketplace.sources.remote")}
							</span>
						</div>
					</li>
				))}
			</ul>
			<p className="marketplace__sources-hint">{t("shell.marketplace.sources.addComingSoon")}</p>
		</div>
	);
}
