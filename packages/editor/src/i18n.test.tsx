/**
 * Editor i18n seam — checks the manifest defaults render verbatim and
 * the `<EditorI18nProvider>` lets a host app override individual keys
 * without re-supplying the whole manifest. Plugin tests rely on this
 * to assert labels without mounting the whole BrainstormEditor.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type EDITOR_I18N_DEFAULTS, EditorI18nProvider, createEditorT, useEditorT } from "./i18n";

function Probe({ id }: { id: keyof typeof EDITOR_I18N_DEFAULTS }) {
	const t = useEditorT();
	return <span>{t(id)}</span>;
}

describe("editor i18n", () => {
	it("createEditorT returns English defaults out of the box", () => {
		const t = createEditorT();
		expect(t("editor.table.rowAbove")).toBe("Row above");
		expect(t("editor.table.deleteTable")).toBe("Delete table");
	});

	it("a missing key in overrides falls through to the default", () => {
		const t = createEditorT({ "editor.table.rowAbove": "Riadok vyššie" });
		expect(t("editor.table.rowAbove")).toBe("Riadok vyššie");
		expect(t("editor.table.rowBelow")).toBe("Row below");
	});

	it("useEditorT without a provider returns the default English t", () => {
		const html = renderToStaticMarkup(<Probe id="editor.table.headerRow" />);
		expect(html).toBe("<span>Header row</span>");
	});

	it("EditorI18nProvider injects overrides for nested useEditorT readers", () => {
		const html = renderToStaticMarkup(
			<EditorI18nProvider overrides={{ "editor.table.headerRow": "Encabezado" }}>
				<Probe id="editor.table.headerRow" />
				<Probe id="editor.table.rowAbove" />
			</EditorI18nProvider>,
		);
		expect(html).toBe("<span>Encabezado</span><span>Row above</span>");
	});

	it("empty overrides object reuses the default t instance (no churn)", () => {
		const html = renderToStaticMarkup(
			<EditorI18nProvider overrides={{}}>
				<Probe id="editor.table.deleteCol" />
			</EditorI18nProvider>,
		);
		expect(html).toBe("<span>Delete column</span>");
	});
});
