import { describe, expect, it } from "vitest";
import { EVENT_COLOR_PRESETS, normalizeColorHint, presetForColor } from "./event-colors";

describe("event-colors", () => {
	it("exposes a non-empty palette of unique keys + CSS values", () => {
		expect(EVENT_COLOR_PRESETS.length).toBeGreaterThan(0);
		const keys = new Set(EVENT_COLOR_PRESETS.map((p) => p.key));
		const values = new Set(EVENT_COLOR_PRESETS.map((p) => p.value));
		expect(keys.size).toBe(EVENT_COLOR_PRESETS.length);
		expect(values.size).toBe(EVENT_COLOR_PRESETS.length);
	});

	it("normalizes blank / non-string colour hints to null", () => {
		expect(normalizeColorHint("#3b82f6")).toBe("#3b82f6");
		expect(normalizeColorHint("   ")).toBeNull();
		expect(normalizeColorHint("")).toBeNull();
		expect(normalizeColorHint(null)).toBeNull();
		expect(normalizeColorHint(123)).toBeNull();
	});

	it("matches a stored colour back to its preset (and null for custom/absent)", () => {
		const preset = EVENT_COLOR_PRESETS[0];
		if (!preset) throw new Error("expected at least one preset");
		expect(presetForColor(preset.value)?.key).toBe(preset.key);
		expect(presetForColor("#000000")).toBeNull();
		expect(presetForColor(null)).toBeNull();
	});
});
