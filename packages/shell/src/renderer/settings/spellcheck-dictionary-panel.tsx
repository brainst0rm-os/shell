/**
 * Settings → Spellcheck dictionary manager (B11.17b). Lists the per-vault custom
 * words (added via the right-click "Add to dictionary" menu, B11.17a) and lets
 * the user prune them. Reads + removes through the privileged dashboard bridge
 * (`window.brainstorm.spellcheck`) — the dashboard is not a sandboxed app, so it
 * uses direct ipcMain, not the broker. Also shows the active spellcheck
 * languages (read-only; explicit language selection + persistence is a follow-up,
 * and on macOS the OS speller auto-detects so no list is exposed).
 */

import { useCallback, useEffect, useState } from "react";
import { t } from "../i18n/t";
import { IconName } from "../ui/icon";
import { IconButton, IconButtonSize } from "../ui/icon-button";

export function SpellcheckDictionaryPanel() {
	const [words, setWords] = useState<readonly string[]>([]);
	const [activeLanguages, setActiveLanguages] = useState<readonly string[]>([]);
	const [loaded, setLoaded] = useState(false);

	const refresh = useCallback(async () => {
		const [list, langs] = await Promise.all([
			window.brainstorm.spellcheck.listWords(),
			window.brainstorm.spellcheck.languages(),
		]);
		setWords(list);
		setActiveLanguages(langs.active);
		setLoaded(true);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const removeWord = async (word: string) => {
		const next = await window.brainstorm.spellcheck.removeWord(word);
		setWords(next);
	};

	return (
		<section className="settings__section">
			<h4 className="settings__section-title">{t("shell.settings.spellcheck.title")}</h4>
			<p className="settings__hint">
				{activeLanguages.length > 0
					? t("shell.settings.spellcheck.languages", { langs: activeLanguages.join(", ") })
					: t("shell.settings.spellcheck.languagesAuto")}
			</p>
			{words.length > 0 ? (
				<ul className="settings__dict-list" aria-live="polite">
					{words.map((word) => (
						<li key={word} className="settings__dict-row">
							<span className="settings__dict-word">{word}</span>
							<IconButton
								icon={IconName.Close}
								label={t("shell.settings.spellcheck.remove", { word })}
								size={IconButtonSize.Sm}
								onClick={() => void removeWord(word)}
							/>
						</li>
					))}
				</ul>
			) : (
				<p className="settings__hint">
					{loaded ? t("shell.settings.spellcheck.empty") : t("shell.common.loading")}
				</p>
			)}
		</section>
	);
}
