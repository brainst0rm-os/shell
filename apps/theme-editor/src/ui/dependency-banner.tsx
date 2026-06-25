/**
 * Missing-dependency banner (9.9.5) — shown above the editor when the
 * loaded composite references component entities that aren't installed.
 * Lists each unresolved slot with a "Reset to default" action that
 * re-points it at its builtin. Renders nothing when nothing is missing.
 */

import type { ReactElement } from "react";
import { type ThemeDependency, ThemeSlot } from "../logic/dependencies";
import type { Translate } from "./translate";

const SLOT_LABEL_KEY: Record<ThemeSlot, string> = {
	[ThemeSlot.TokenSet]: "slot.tokenSet",
	[ThemeSlot.IconPack]: "slot.iconPack",
	[ThemeSlot.Typography]: "slot.typography",
	[ThemeSlot.StylePack]: "slot.stylePack",
};

export type DependencyBannerProps = {
	missing: ReadonlyArray<ThemeDependency>;
	t: Translate;
	onReset(slot: ThemeSlot): void;
};

export function DependencyBanner({
	missing,
	t,
	onReset,
}: DependencyBannerProps): ReactElement | null {
	if (missing.length === 0) return null;
	return (
		<section className="te-banner" role="alert">
			<p className="te-banner__text">{t("deps.message")}</p>
			{missing.map((dep) => (
				<div className="te-banner__row" key={dep.slot}>
					<span className="te-banner__slot">{t(SLOT_LABEL_KEY[dep.slot])}</span>
					<button type="button" className="te-banner__reset" onClick={() => onReset(dep.slot)}>
						{t("deps.reset")}
					</button>
				</div>
			))}
		</section>
	);
}
