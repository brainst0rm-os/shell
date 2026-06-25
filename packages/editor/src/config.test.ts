import { describe, expect, it } from "vitest";
import { DEFAULT_EDITOR_NAMESPACE, createEditorConfig } from "./config";
import { BASELINE_NODES } from "./nodes";
import { baselineTheme, mergeTheme } from "./theme";

describe("createEditorConfig", () => {
	it("defaults namespace, editable, nodes, null editorState, console error handler", () => {
		const config = createEditorConfig();
		expect(config.namespace).toBe(DEFAULT_EDITOR_NAMESPACE);
		expect(config.editable).toBe(true);
		expect(config.nodes).toBe(BASELINE_NODES);
		expect(config.editorState).toBeNull();
		expect(typeof config.onError).toBe("function");
	});

	it("applies overrides", () => {
		const onError = () => {};
		const config = createEditorConfig({ namespace: "x", editable: false, onError });
		expect(config.namespace).toBe("x");
		expect(config.editable).toBe(false);
		expect(config.onError).toBe(onError);
	});
});

describe("mergeTheme", () => {
	it("returns the baseline untouched when no override", () => {
		expect(mergeTheme()).toBe(baselineTheme);
	});

	it("merges nested maps without dropping baseline keys", () => {
		const merged = mergeTheme({ text: { bold: "custom-bold" } });
		expect(merged.text?.bold).toBe("custom-bold");
		// sibling baseline text keys survive
		expect(merged.text?.italic).toBe(baselineTheme.text?.italic);
		// other top-level baseline keys survive
		expect(merged.paragraph).toBe(baselineTheme.paragraph);
		expect(merged.heading?.h1).toBe(baselineTheme.heading?.h1);
	});

	it("overrides a top-level scalar key", () => {
		const merged = mergeTheme({ paragraph: "p2" });
		expect(merged.paragraph).toBe("p2");
		expect(merged.quote).toBe(baselineTheme.quote);
	});
});
