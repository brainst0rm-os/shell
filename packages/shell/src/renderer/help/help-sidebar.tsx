/**
 * Help-1 — section/topic tree built from the bundled corpus. Renders a
 * flat list of articles grouped by their declaring section. The corpus
 * is bounded (~tens of articles) so the list isn't virtualised; if the
 * manifest ever grows beyond a screenful, swap in `<VirtualList>` per
 * [[feedback_virtualize_lists_by_default]] without touching the
 * caller-facing API.
 */

import { useMemo } from "react";
import type { HelpArticle } from "../../preload";
import { t } from "../i18n/t";

const SECTION_TITLE_KEYS: Record<string, string> = {
	"getting-started": "shell.help.section.gettingStarted",
	concepts: "shell.help.section.concepts",
	"app-notes": "shell.help.section.app.notes",
	"app-tasks": "shell.help.section.app.tasks",
	"app-files": "shell.help.section.app.files",
	"app-calendar": "shell.help.section.app.calendar",
	"app-journal": "shell.help.section.app.journal",
	"app-database": "shell.help.section.app.database",
	"app-graph": "shell.help.section.app.graph",
	"app-whiteboard": "shell.help.section.app.whiteboard",
	"app-bookmarks": "shell.help.section.app.bookmarks",
	"app-code-editor": "shell.help.section.app.codeEditor",
	customising: "shell.help.section.customising",
	privacy: "shell.help.section.privacy",
};

export type HelpSidebarProps = {
	readonly articles: readonly HelpArticle[];
	readonly activeTopicId: string | null;
	readonly onSelect: (topicId: string) => void;
};

export function HelpSidebar({ articles, activeTopicId, onSelect }: HelpSidebarProps) {
	const grouped = useMemo(() => groupBySection(articles), [articles]);
	return (
		<nav className="help__nav" aria-label={t("shell.help.nav")}>
			{grouped.map(({ sectionId, items }) => (
				<section key={sectionId} className="help__nav-section">
					<h3 className="help__nav-section-title">
						{t(SECTION_TITLE_KEYS[sectionId] ?? `shell.help.section.${sectionId}`)}
					</h3>
					<ul className="help__nav-list">
						{items.map((article) => (
							<li key={article.topicId}>
								<button
									type="button"
									className={
										article.topicId === activeTopicId
											? "help__nav-item help__nav-item--active"
											: "help__nav-item"
									}
									onClick={() => onSelect(article.topicId)}
									data-testid="help-nav-item"
									aria-current={article.topicId === activeTopicId ? "page" : undefined}
								>
									{article.title}
								</button>
							</li>
						))}
					</ul>
				</section>
			))}
		</nav>
	);
}

function groupBySection(
	articles: readonly HelpArticle[],
): Array<{ sectionId: string; items: HelpArticle[] }> {
	const order: string[] = [];
	const byId = new Map<string, HelpArticle[]>();
	for (const a of articles) {
		const bucket = byId.get(a.sectionId);
		if (bucket) {
			bucket.push(a);
		} else {
			order.push(a.sectionId);
			byId.set(a.sectionId, [a]);
		}
	}
	return order.map((sectionId) => ({ sectionId, items: byId.get(sectionId) ?? [] }));
}
