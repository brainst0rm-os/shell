/**
 * @vitest-environment jsdom
 *
 * Compose / edit form. Pins that edit mode round-trips every field the
 * inline chips also cover, so a user changing several properties at once
 * via the popover gets one save with all of them — not a chip dance.
 */

import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types/project";
import { Priority, type Task } from "../types/task";
import { buildComposeForm } from "./compose-view";

function project(id: string, name: string): Project {
	return {
		id,
		name,
		statusKey: null,
		milestoneAt: null,
		colorHint: null,
		createdAt: 0,
		updatedAt: 0,
	};
}

function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "task-1",
		name: "Original",
		completedAt: null,
		priority: Priority.High,
		scheduledAt: Date.UTC(2026, 5, 1),
		dueAt: Date.UTC(2026, 5, 5),
		projectId: "p-1",
		assigneeId: null,
		parentId: null,
		recurrence: null,
		statusKey: null,
		createdAt: 0,
		updatedAt: 0,
		notes: "Existing note",
		...overrides,
	};
}

describe("buildComposeForm — edit mode", () => {
	it("prefills every field from the passed task", () => {
		const form = buildComposeForm({
			mode: { kind: "edit", task: task() },
			projects: [project("p-1", "Garden"), project("p-2", "Work")],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		const value = form.read();
		expect(value.name).toBe("Original");
		expect(value.projectId).toBe("p-1");
		expect(value.priority).toBe(Priority.High);
		expect(value.scheduledAt).toBe(Date.UTC(2026, 5, 1));
		expect(value.dueAt).toBe(Date.UTC(2026, 5, 5));
	});

	it("does not surface a notes field (rich notes live in the inspector body)", () => {
		const form = buildComposeForm({
			mode: { kind: "edit", task: task() },
			projects: [project("p-1", "Garden")],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		expect("notes" in form.read()).toBe(false);
		expect(form.body.querySelector(".tasks-compose__textarea")).toBeNull();
	});

	it("a user-edited input flows through read()", () => {
		const form = buildComposeForm({
			mode: { kind: "edit", task: task() },
			projects: [project("p-1", "Garden")],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		const nameInput = form.body.querySelector<HTMLInputElement>(".tasks-compose__input");
		if (!nameInput) throw new Error("expected name input to be mounted");
		nameInput.value = "Renamed";
		expect(form.read().name).toBe("Renamed");
	});

	it("the submit button reads Save in edit mode (Create in create mode)", () => {
		const edit = buildComposeForm({
			mode: { kind: "edit", task: task() },
			projects: [],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		const create = buildComposeForm({
			mode: { kind: "create", defaultProjectId: null },
			projects: [],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		const editSubmit = edit.footer.querySelector<HTMLButtonElement>("[data-bs-primary]");
		const createSubmit = create.footer.querySelector<HTMLButtonElement>("[data-bs-primary]");
		expect(editSubmit?.textContent).toBe("Save");
		expect(createSubmit?.textContent).toBe("Create task");
	});
});

describe("buildComposeForm — create mode", () => {
	it("defaults the project select when defaultProjectId matches", () => {
		const form = buildComposeForm({
			mode: { kind: "create", defaultProjectId: "p-2" },
			projects: [project("p-1", "A"), project("p-2", "B")],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		expect(form.read().projectId).toBe("p-2");
	});

	it("returns empty defaults when nothing is preset", () => {
		const form = buildComposeForm({
			mode: { kind: "create", defaultProjectId: null },
			projects: [project("p-1", "A")],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		expect(form.read()).toEqual({
			name: "",
			projectId: null,
			priority: Priority.None,
			scheduledAt: null,
			dueAt: null,
		});
	});
});

describe("date fields use the shared themed picker (F-229)", () => {
	it("renders no native date/time inputs — the picker is the SDK calendar popover", () => {
		const form = buildComposeForm({
			mode: { kind: "edit", task: task() },
			projects: [],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		expect(form.body.querySelector('input[type="date"]')).toBeNull();
		expect(form.body.querySelector('input[type="datetime-local"]')).toBeNull();
		expect(form.body.querySelector('input[type="time"]')).toBeNull();
		expect(form.body.querySelectorAll(".tasks-compose__date-trigger").length).toBe(2);
	});

	it("a prefilled date renders its formatted value and is not marked empty", () => {
		const form = buildComposeForm({
			mode: { kind: "edit", task: task() },
			projects: [],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		const text = form.body.querySelector<HTMLElement>(".tasks-compose__date-text");
		if (!text) throw new Error("expected a date trigger to be mounted");
		expect(text.dataset.empty).toBe("false");
		expect(text.textContent).not.toBe("Set date");
	});

	it("the clear affordance resets the field to null and read() reflects it", () => {
		const form = buildComposeForm({
			mode: { kind: "edit", task: task() },
			projects: [],
			onSubmit: vi.fn(),
			onCancel: vi.fn(),
		});
		const triggers = form.body.querySelectorAll<HTMLElement>(".tasks-compose__date-trigger");
		const scheduledClear = triggers[0]?.querySelector<HTMLButtonElement>(
			".tasks-compose__date-clear",
		);
		if (!scheduledClear) throw new Error("expected a clear button on the scheduled field");
		scheduledClear.click();
		expect(form.read().scheduledAt).toBeNull();
		expect(form.read().dueAt).toBe(Date.UTC(2026, 5, 5));
	});
});
