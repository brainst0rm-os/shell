import type { EditorThemeClasses } from "lexical";

/** Lexical theme = a map from node class-names to CSS class names. The CSS
 *  matching these lives in `styles.css` under `.notes__block--*`. Keeping
 *  the names BEM-flavoured so they don't clash with shell classes. */
export const editorTheme: EditorThemeClasses = {
	paragraph: "notes__paragraph",
	heading: {
		h1: "notes__h1",
		h2: "notes__h2",
		h3: "notes__h3",
	},
	quote: "notes__quote",
	list: {
		ul: "notes__list notes__list--bullet",
		ol: "notes__list notes__list--numbered",
		listitem: "notes__list-item",
		listitemChecked: "notes__list-item notes__list-item--checked",
		listitemUnchecked: "notes__list-item notes__list-item--unchecked",
		nested: { listitem: "notes__list-item--nested" },
	},
	text: {
		bold: "notes__text--bold",
		italic: "notes__text--italic",
		underline: "notes__text--underline",
		strikethrough: "notes__text--strike",
		code: "notes__text--code",
	},
	code: "notes__code",
	link: "notes__link",
	table: "notes__table",
	tableRow: "notes__table-row",
	tableCell: "notes__table-cell",
	tableCellHeader: "notes__table-cell--header",
	tableSelected: "notes__table--selected",
	tableCellSelected: "notes__table-cell--selected",
};
