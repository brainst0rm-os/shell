import { describe, expect, it } from "vitest";
import { discoverSources, labelForSourceKey } from "./calendar-sources";
import { buildDateKeyInfo } from "./from-vault-entities";
import {
	EVENT_SOURCE_KEY,
	JOURNAL_SOURCE_KEY,
	type ScheduledItem,
	colorForSourceKey,
	sourceKeyFor,
} from "./scheduled-item";

const TASK = "brainstorm/Task/v1";
const PERSON = "brainstorm/Person/v1";

function item(sourceKey: string, sourceEntityId: string, start = 1_700_000_000_000): ScheduledItem {
	return {
		id: `${sourceEntityId}:${sourceKey}`,
		sourceKey,
		sourceEntityId,
		title: sourceEntityId,
		icon: null,
		start,
		end: null,
		allDay: false,
		location: null,
		recurrence: null,
		colorHint: null,
	};
}

describe("labelForSourceKey", () => {
	it("uses built-in names for the Event / Journal sources", () => {
		expect(labelForSourceKey(EVENT_SOURCE_KEY)).toBe("Events");
		expect(labelForSourceKey(JOURNAL_SOURCE_KEY)).toBe("Journal");
	});

	it("renders '<Type> · <Property>' using the catalog name when available", () => {
		const info = buildDateKeyInfo([{ key: "scheduledAt", name: "Scheduled" }]);
		expect(labelForSourceKey(sourceKeyFor(TASK, "scheduledAt"), info)).toBe("Tasks · Scheduled");
	});

	it("falls back to a humanized property key when no catalog name is known", () => {
		expect(labelForSourceKey(sourceKeyFor(TASK, "reviewOn"))).toBe("Tasks · Review On");
	});
});

describe("discoverSources", () => {
	it("groups items by source key with a distinct-object count", () => {
		const sources = discoverSources(
			[
				item(sourceKeyFor(TASK, "scheduledAt"), "t1"),
				item(sourceKeyFor(TASK, "scheduledAt"), "t2"),
				item(sourceKeyFor(TASK, "dueAt"), "t1"),
				item(EVENT_SOURCE_KEY, "e1"),
			],
			buildDateKeyInfo([]),
		);
		const byKey = new Map(sources.map((s) => [s.key, s]));
		expect(byKey.get(sourceKeyFor(TASK, "scheduledAt"))?.count).toBe(2);
		expect(byKey.get(sourceKeyFor(TASK, "dueAt"))?.count).toBe(1);
		expect(byKey.get(EVENT_SOURCE_KEY)?.count).toBe(1);
	});

	it("counts a recurring source once per object, not once per occurrence", () => {
		// A yearly birthday expands into many items but is one object.
		const key = sourceKeyFor(PERSON, "birthday");
		const sources = discoverSources(
			[item(key, "p1", 1), item(key, "p1", 2), item(key, "p1", 3)],
			buildDateKeyInfo([]),
		);
		expect(sources).toHaveLength(1);
		expect(sources[0]?.count).toBe(1);
	});

	it("assigns each source its legend colour and sorts by count desc", () => {
		const sources = discoverSources(
			[
				item(sourceKeyFor(TASK, "dueAt"), "t1"),
				item(EVENT_SOURCE_KEY, "e1"),
				item(EVENT_SOURCE_KEY, "e2"),
			],
			buildDateKeyInfo([]),
		);
		expect(sources[0]?.key).toBe(EVENT_SOURCE_KEY);
		expect(sources[0]?.color).toBe(colorForSourceKey(EVENT_SOURCE_KEY));
	});
});

describe("colorForSourceKey", () => {
	it("returns the override colour for a known source", () => {
		expect(colorForSourceKey(EVENT_SOURCE_KEY)).toBe("#7c83ff");
		expect(colorForSourceKey(sourceKeyFor(PERSON, "birthday"))).toBe("#c66a8c");
	});

	it("is stable + deterministic for an unknown source key", () => {
		const key = sourceKeyFor("acme/Contract/v1", "reviewOn");
		expect(colorForSourceKey(key)).toBe(colorForSourceKey(key));
		expect(colorForSourceKey(key)).toMatch(/^#[0-9a-f]{6}$/);
	});
});
