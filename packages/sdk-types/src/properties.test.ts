import { describe, expect, it } from "vitest";
import {
	ALLOWED_VIEWS,
	CARDINALITY_HARD_MAX,
	DEFAULT_CARDINALITY,
	DateGranularity,
	FILE_ENTITY_TYPE,
	KIND_PRESET_ORDER,
	PRESET_DEFAULTS,
	type PropertyDef,
	PropertyFormat,
	PropertyKindPreset,
	PropertyView,
	ValueType,
	defaultViewFor,
	isAllowedView,
	isMultiValued,
	isRequired,
	presetOf,
} from "./properties";

describe("ValueType / PropertyView / PropertyFormat enums", () => {
	it("ValueType covers the six canonical base types", () => {
		expect(Object.values(ValueType).sort()).toEqual(
			["boolean", "date", "entityRef", "number", "richText", "text"].sort(),
		);
	});

	it("PropertyFormat lists the nine supported formats", () => {
		expect(Object.values(PropertyFormat).sort()).toEqual(
			[
				"code",
				"currency",
				"duration",
				"email",
				"formula",
				"markdown",
				"percent",
				"phone",
				"url",
			].sort(),
		);
	});

	it("DateGranularity covers date / datetime / time", () => {
		expect(Object.values(DateGranularity).sort()).toEqual(["date", "datetime", "time"]);
	});

	it("PropertyView contains every v1 view name (text-family + others)", () => {
		const views = Object.values(PropertyView);
		// Spot-check the well-known v1 views; the union is closed.
		expect(views).toContain(PropertyView.Pill);
		expect(views).toContain(PropertyView.Plain);
		expect(views).toContain(PropertyView.Tag);
		expect(views).toContain(PropertyView.TagList);
		expect(views).toContain(PropertyView.Checkbox);
		expect(views).toContain(PropertyView.Toggle);
		expect(views).toContain(PropertyView.FileList);
		expect(views).toContain(PropertyView.LinkCard);
		expect(views).toContain(PropertyView.LinkInline);
		expect(views).toContain(PropertyView.Block);
	});
});

describe("Cardinality helpers", () => {
	it("DEFAULT_CARDINALITY is { min: 0, max: 1 } and frozen", () => {
		expect(DEFAULT_CARDINALITY).toEqual({ min: 0, max: 1 });
		expect(Object.isFrozen(DEFAULT_CARDINALITY)).toBe(true);
	});

	it("CARDINALITY_HARD_MAX is 50 per the spec", () => {
		expect(CARDINALITY_HARD_MAX).toBe(50);
	});

	it("isMultiValued — undefined / { max: 1 } → false, { max: > 1 } → true", () => {
		expect(isMultiValued()).toBe(false);
		expect(isMultiValued({ min: 0, max: 1 })).toBe(false);
		expect(isMultiValued({ min: 1, max: 1 })).toBe(false);
		expect(isMultiValued({ min: 0, max: 2 })).toBe(true);
		expect(isMultiValued({ min: 1, max: 50 })).toBe(true);
	});

	it("isRequired — { min: 0, ... } → false, { min: >= 1, ... } → true", () => {
		expect(isRequired()).toBe(false);
		expect(isRequired({ min: 0, max: 1 })).toBe(false);
		expect(isRequired({ min: 1, max: 1 })).toBe(true);
		expect(isRequired({ min: 2, max: 5 })).toBe(true);
	});
});

describe("ALLOWED_VIEWS", () => {
	it("declares an entry for every ValueType", () => {
		for (const v of Object.values(ValueType)) {
			expect(ALLOWED_VIEWS[v]).toBeDefined();
			expect(ALLOWED_VIEWS[v].length).toBeGreaterThan(0);
		}
	});

	it("text accepts pill / plain / multiline / tag / tag-list", () => {
		expect([...ALLOWED_VIEWS[ValueType.Text]]).toEqual([
			PropertyView.Pill,
			PropertyView.Plain,
			PropertyView.Multiline,
			PropertyView.Tag,
			PropertyView.TagList,
		]);
	});

	it("boolean accepts only checkbox / toggle", () => {
		expect([...ALLOWED_VIEWS[ValueType.Boolean]]).toEqual([
			PropertyView.Checkbox,
			PropertyView.Toggle,
		]);
	});

	it("isAllowedView returns true / false against the matrix", () => {
		expect(isAllowedView(ValueType.Text, PropertyView.Pill)).toBe(true);
		expect(isAllowedView(ValueType.Text, PropertyView.Gallery)).toBe(false);
		expect(isAllowedView(ValueType.Boolean, PropertyView.Checkbox)).toBe(true);
		expect(isAllowedView(ValueType.Boolean, PropertyView.Pill)).toBe(false);
	});

	it("freezes the allowed-views table", () => {
		expect(Object.isFrozen(ALLOWED_VIEWS)).toBe(true);
		expect(Object.isFrozen(ALLOWED_VIEWS[ValueType.Text])).toBe(true);
	});
});

describe("defaultViewFor", () => {
	function makeDef(overrides: Partial<PropertyDef> & { valueType: ValueType }): PropertyDef {
		return {
			key: "prop_test",
			name: "Test",
			icon: null,
			...overrides,
		} as PropertyDef;
	}

	it("honors an explicit display.view when set", () => {
		const def = makeDef({
			valueType: ValueType.Text,
			display: { view: PropertyView.Plain },
		});
		expect(defaultViewFor(def)).toBe(PropertyView.Plain);
	});

	it("text without modifiers → Pill", () => {
		expect(defaultViewFor(makeDef({ valueType: ValueType.Text }))).toBe(PropertyView.Pill);
	});

	it("text + vocabulary (singleton) → Tag (Select-shaped)", () => {
		expect(
			defaultViewFor(
				makeDef({
					valueType: ValueType.Text,
					vocabulary: { dictionaryId: "d1" },
				}),
			),
		).toBe(PropertyView.Tag);
	});

	it("text + vocabulary + count.max > 1 → TagList (MultiSelect-shaped)", () => {
		expect(
			defaultViewFor(
				makeDef({
					valueType: ValueType.Text,
					vocabulary: { dictionaryId: "d1" },
					count: { min: 0, max: 5 },
				}),
			),
		).toBe(PropertyView.TagList);
	});

	it("boolean → Checkbox", () => {
		expect(defaultViewFor(makeDef({ valueType: ValueType.Boolean }))).toBe(PropertyView.Checkbox);
	});

	it("entityRef + File allowedTypes → FileList", () => {
		expect(
			defaultViewFor(
				makeDef({
					valueType: ValueType.EntityRef,
					allowedTypes: [FILE_ENTITY_TYPE],
				}),
			),
		).toBe(PropertyView.FileList);
	});

	it("entityRef without File allowedTypes → LinkCard", () => {
		expect(defaultViewFor(makeDef({ valueType: ValueType.EntityRef }))).toBe(PropertyView.LinkCard);
	});

	it("richText → Block", () => {
		expect(defaultViewFor(makeDef({ valueType: ValueType.RichText }))).toBe(PropertyView.Block);
	});
});

describe("PropertyKindPreset + PRESET_DEFAULTS + presetOf", () => {
	it("KIND_PRESET_ORDER contains every preset exactly once", () => {
		const sorted = [...KIND_PRESET_ORDER].sort();
		const expected = Object.values(PropertyKindPreset).sort();
		expect(sorted).toEqual(expected);
		expect(Object.isFrozen(KIND_PRESET_ORDER)).toBe(true);
	});

	it("PRESET_DEFAULTS declares defaults for every preset", () => {
		for (const preset of Object.values(PropertyKindPreset)) {
			expect(PRESET_DEFAULTS[preset]).toBeDefined();
		}
		expect(Object.isFrozen(PRESET_DEFAULTS)).toBe(true);
	});

	it("Select / MultiSelect presets mark requiresVocabulary", () => {
		expect(PRESET_DEFAULTS[PropertyKindPreset.Select].requiresVocabulary).toBe(true);
		expect(PRESET_DEFAULTS[PropertyKindPreset.MultiSelect].requiresVocabulary).toBe(true);
		expect(PRESET_DEFAULTS[PropertyKindPreset.Text].requiresVocabulary).toBeUndefined();
	});

	it("Url / Email / Phone presets pick the matching format on a text base", () => {
		expect(PRESET_DEFAULTS[PropertyKindPreset.Url].valueType).toBe(ValueType.Text);
		expect(PRESET_DEFAULTS[PropertyKindPreset.Url].format).toBe(PropertyFormat.Url);
		expect(PRESET_DEFAULTS[PropertyKindPreset.Email].format).toBe(PropertyFormat.Email);
		expect(PRESET_DEFAULTS[PropertyKindPreset.Phone].format).toBe(PropertyFormat.Phone);
	});

	it("File preset pins allowedTypes to the canonical File entity type", () => {
		expect(PRESET_DEFAULTS[PropertyKindPreset.File].valueType).toBe(ValueType.EntityRef);
		expect(PRESET_DEFAULTS[PropertyKindPreset.File].allowedTypes).toEqual([FILE_ENTITY_TYPE]);
	});

	it("presetOf reproduces the preset that produced the def shape", () => {
		const make = (over: Partial<PropertyDef> & { valueType: ValueType }): PropertyDef => ({
			key: "prop_x",
			name: "X",
			icon: null,
			...over,
		});
		expect(presetOf(make({ valueType: ValueType.Text }))).toBe(PropertyKindPreset.Text);
		expect(presetOf(make({ valueType: ValueType.Number }))).toBe(PropertyKindPreset.Number);
		expect(presetOf(make({ valueType: ValueType.Boolean }))).toBe(PropertyKindPreset.Boolean);
		expect(presetOf(make({ valueType: ValueType.Date }))).toBe(PropertyKindPreset.Date);
		expect(presetOf(make({ valueType: ValueType.Text, vocabulary: { dictionaryId: "d1" } }))).toBe(
			PropertyKindPreset.Select,
		);
		expect(
			presetOf(
				make({
					valueType: ValueType.Text,
					vocabulary: { dictionaryId: "d1" },
					count: { min: 0, max: 5 },
				}),
			),
		).toBe(PropertyKindPreset.MultiSelect);
		expect(presetOf(make({ valueType: ValueType.Text, format: PropertyFormat.Url }))).toBe(
			PropertyKindPreset.Url,
		);
		expect(presetOf(make({ valueType: ValueType.Text, format: PropertyFormat.Email }))).toBe(
			PropertyKindPreset.Email,
		);
		expect(presetOf(make({ valueType: ValueType.Text, format: PropertyFormat.Phone }))).toBe(
			PropertyKindPreset.Phone,
		);
		expect(presetOf(make({ valueType: ValueType.EntityRef, allowedTypes: [FILE_ENTITY_TYPE] }))).toBe(
			PropertyKindPreset.File,
		);
		expect(presetOf(make({ valueType: ValueType.EntityRef }))).toBe(PropertyKindPreset.Link);
	});
});
