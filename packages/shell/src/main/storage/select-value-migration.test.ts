import { describe, expect, it } from "vitest";
import { migrateLegacySelectValues } from "./select-value-migration";

describe("migrateLegacySelectValues", () => {
	it("rewrites a legacy status id to its bare key", () => {
		const out = migrateLegacySelectValues({ statusKey: "di-dict-task-status-done", name: "T" });
		expect(out.changed).toBe(true);
		expect(out.properties.statusKey).toBe("done");
		expect(out.properties.name).toBe("T");
	});

	it("rewrites a legacy priority id", () => {
		const out = migrateLegacySelectValues({ priority: "di-dict-task-priority-high" });
		expect(out.properties.priority).toBe("high");
	});

	it("rewrites legacy ids inside a multi-value array", () => {
		const out = migrateLegacySelectValues({
			tags: ["di-dict-task-status-todo", "keep-me", "di-dict-task-priority-low"],
		});
		expect(out.changed).toBe(true);
		expect(out.properties.tags).toEqual(["todo", "keep-me", "low"]);
	});

	it("leaves an already-bare key untouched (idempotent)", () => {
		const props = { statusKey: "done" };
		const out = migrateLegacySelectValues(props);
		expect(out.changed).toBe(false);
		expect(out.properties).toBe(props);
	});

	it("leaves a user-created opaque option id untouched", () => {
		// `newDictionaryItemId()` → `di_<ts>_<rand>` never matches the
		// `di-dict-task-…` prefix, so a user option survives.
		const out = migrateLegacySelectValues({ stage: "di_1q5a7b_abc123" });
		expect(out.changed).toBe(false);
		expect(out.properties.stage).toBe("di_1q5a7b_abc123");
	});

	it("preserves a hyphenated key suffix verbatim", () => {
		const out = migrateLegacySelectValues({ statusKey: "di-dict-task-status-in-flight" });
		expect(out.properties.statusKey).toBe("in-flight");
	});

	it("ignores non-string scalar values", () => {
		const props = { count: 3, done: true, missing: null };
		const out = migrateLegacySelectValues(props);
		expect(out.changed).toBe(false);
	});
});
