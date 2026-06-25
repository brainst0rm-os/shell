// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { serializeCalendar } from "../logic/ics";
import type { CalendarFileHandle, CalendarFilesService } from "../storage/runtime";
import type { Event } from "../types/event";
import { exportEventsToIcs, importEventsFromIcs } from "./ics-actions";

function makeEvent(over: Partial<Event> = {}): Event {
	const start = new Date(2026, 4, 14, 10, 0, 0).getTime();
	return {
		id: "evt-1",
		title: "Standup",
		icon: null,
		start,
		end: start + 3_600_000,
		allDay: false,
		location: null,
		recurrence: null,
		statusKey: null,
		colorHint: null,
		reminders: [],
		attendees: [],
		timeZone: null,
		createdAt: start,
		updatedAt: start,
		...over,
	};
}

const HANDLE: CalendarFileHandle = { handleId: "h1", displayName: "calendar.ics" };

describe("exportEventsToIcs", () => {
	it("writes serialized ICS bytes to the chosen file", async () => {
		const written: Uint8Array[] = [];
		const files: CalendarFilesService = {
			requestOpen: vi.fn(async () => []),
			requestSave: vi.fn(async () => HANDLE),
			read: vi.fn(async () => new Uint8Array()),
			write: vi.fn(async (_h, data) => {
				written.push(data instanceof Uint8Array ? data : new Uint8Array(data));
			}),
		};
		const notify = vi.fn();
		await exportEventsToIcs(files, [makeEvent()], notify);
		expect(files.write).toHaveBeenCalledTimes(1);
		const text = new TextDecoder().decode(written[0]);
		expect(text).toContain("BEGIN:VCALENDAR");
		expect(text).toContain("SUMMARY:Standup");
	});

	it("notifies + no-ops on an empty event list", async () => {
		const files: CalendarFilesService = {
			requestOpen: vi.fn(async () => []),
			requestSave: vi.fn(async () => HANDLE),
			read: vi.fn(async () => new Uint8Array()),
			write: vi.fn(async () => undefined),
		};
		const notify = vi.fn();
		await exportEventsToIcs(files, [], notify);
		expect(files.requestSave).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalled();
	});
});

describe("importEventsFromIcs", () => {
	it("reads + parses chosen files and hands events to onImport", async () => {
		const ics = serializeCalendar([makeEvent({ title: "Imported" })]);
		const files: CalendarFilesService = {
			requestOpen: vi.fn(async () => [HANDLE]),
			requestSave: vi.fn(async () => null),
			read: vi.fn(async () => new TextEncoder().encode(ics)),
			write: vi.fn(async () => undefined),
		};
		const onImport = vi.fn();
		await importEventsFromIcs(files, onImport);
		expect(onImport).toHaveBeenCalledTimes(1);
		const imported = onImport.mock.calls[0]?.[0] as Event[];
		expect(imported[0]?.title).toBe("Imported");
	});

	it("does nothing when the open dialog is cancelled", async () => {
		const files: CalendarFilesService = {
			requestOpen: vi.fn(async () => []),
			requestSave: vi.fn(async () => null),
			read: vi.fn(async () => new Uint8Array()),
			write: vi.fn(async () => undefined),
		};
		const onImport = vi.fn();
		await importEventsFromIcs(files, onImport);
		expect(onImport).not.toHaveBeenCalled();
	});
});
