import { type PropertyDef, ValueType } from "@brainstorm/sdk-types";
import { describe, expect, it } from "vitest";
import { Priority, type Task } from "../types/task";
import {
	PERSON_ENTITY_TYPE,
	TASK_PROPERTY_DEFS,
	TASK_PROP_KEY,
	boundCustomDefs,
	parseAssigneeValue,
	taskToValues,
	unboundCustomDefs,
} from "./task-properties";

function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		name: "Write the bridge",
		completedAt: null,
		priority: Priority.High,
		scheduledAt: null,
		dueAt: null,
		projectId: null,
		assigneeId: null,
		parentId: null,
		recurrence: null,
		statusKey: null,
		createdAt: 1,
		updatedAt: 2,
		...overrides,
	};
}

const ctx = { priorityLabel: "High priority", projectName: "Inbox", statusLabel: "todo" };

describe("task-properties bridge", () => {
	it("exposes status / priority / scheduled / due / project / assignee / created / updated defs in order", () => {
		expect(TASK_PROPERTY_DEFS.map((d) => d.key)).toEqual([
			TASK_PROP_KEY.status,
			TASK_PROP_KEY.priority,
			TASK_PROP_KEY.scheduled,
			TASK_PROP_KEY.due,
			TASK_PROP_KEY.project,
			TASK_PROP_KEY.assignee,
			TASK_PROP_KEY.created,
			TASK_PROP_KEY.updated,
		]);
	});

	it("models Assignee as a scalar entity-ref scoped to Person/v1 (F-152)", () => {
		const def = TASK_PROPERTY_DEFS.find((d) => d.key === TASK_PROP_KEY.assignee);
		expect(def?.valueType).toBe(ValueType.EntityRef);
		expect(def?.allowedTypes).toEqual([PERSON_ENTITY_TYPE]);
		expect(def?.count).toEqual({ min: 0, max: 1 });
	});

	it("maps the resolved labels straight onto text values", () => {
		const values = taskToValues(task(), ctx);
		expect(values[TASK_PROP_KEY.priority]).toBe("High priority");
		expect(values[TASK_PROP_KEY.project]).toBe("Inbox");
		expect(values[TASK_PROP_KEY.status]).toBe("todo");
	});

	it("wraps a set date in the stored date envelope and leaves an unset one null", () => {
		const values = taskToValues(task({ scheduledAt: 123, dueAt: null }), ctx);
		expect(values[TASK_PROP_KEY.scheduled]).toMatchObject({ at: 123 });
		expect(values[TASK_PROP_KEY.due]).toBeNull();
	});

	it("always carries the created / updated timestamps", () => {
		const values = taskToValues(task({ createdAt: 10, updatedAt: 20 }), ctx);
		expect(values[TASK_PROP_KEY.created]).toMatchObject({ at: 10 });
		expect(values[TASK_PROP_KEY.updated]).toMatchObject({ at: 20 });
	});

	it("maps the assignee ref id into the cell value, empty when unassigned", () => {
		expect(taskToValues(task({ assigneeId: "person_mira" }), ctx)[TASK_PROP_KEY.assignee]).toBe(
			"person_mira",
		);
		expect(taskToValues(task(), ctx)[TASK_PROP_KEY.assignee]).toBe("");
	});

	it("parses the assignee cell's edited value back to an id or null", () => {
		expect(parseAssigneeValue("person_priya")).toBe("person_priya");
		expect(parseAssigneeValue("")).toBeNull();
		expect(parseAssigneeValue(null)).toBeNull();
		expect(parseAssigneeValue(undefined)).toBeNull();
		expect(parseAssigneeValue(42)).toBeNull();
		expect(parseAssigneeValue({ value: "not-a-scalar" })).toBeNull();
	});
});

describe("custom-field defs (9.14.16)", () => {
	const def = (key: string, name: string): PropertyDef => ({
		key,
		name,
		icon: null,
		valueType: ValueType.Text,
	});
	const catalog = new Map<string, PropertyDef>([
		["p.b", def("p.b", "Beta")],
		["p.a", def("p.a", "Alpha")],
		["p.c", def("p.c", "Gamma")],
	]);

	it("bound defs are the catalog-resolvable keys of the bag, name-sorted", () => {
		const bound = boundCustomDefs({ "p.c": "x", "p.a": "y", "p.gone": "z" }, catalog);
		expect(bound.map((d) => d.key)).toEqual(["p.a", "p.c"]);
	});

	it("unbound defs are the rest of the catalog, name-sorted; empty bag = all", () => {
		expect(unboundCustomDefs({ "p.a": "y" }, catalog).map((d) => d.key)).toEqual(["p.b", "p.c"]);
		expect(unboundCustomDefs(undefined, catalog).map((d) => d.key)).toEqual(["p.a", "p.b", "p.c"]);
	});
});

describe("assignee catalog def (F-152)", () => {
	it("mirrors the dev seeder's def so the Graph edge derives in any vault", async () => {
		const { ASSIGNEE_CATALOG_DEF, PERSON_ENTITY_TYPE } = await import("./task-properties");
		const { ValueType } = await import("@brainstorm/sdk-types");
		expect(ASSIGNEE_CATALOG_DEF.key).toBe("assigneeId");
		expect(ASSIGNEE_CATALOG_DEF.valueType).toBe(ValueType.EntityRef);
		expect(ASSIGNEE_CATALOG_DEF).toMatchObject({
			allowedTypes: [PERSON_ENTITY_TYPE],
			count: { min: 0, max: 1 },
		});
	});
});
