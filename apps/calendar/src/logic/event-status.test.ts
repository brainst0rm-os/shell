import { describe, expect, it } from "vitest";
import { EVENT_STATUSES, EventStatus, normalizeStatusKey, statusToStored } from "./event-status";

describe("event-status", () => {
	it("lists confirmed first, then tentative, then cancelled", () => {
		expect([...EVENT_STATUSES]).toEqual([
			EventStatus.Confirmed,
			EventStatus.Tentative,
			EventStatus.Cancelled,
		]);
	});

	it("normalizes a known key and rejects everything else", () => {
		expect(normalizeStatusKey("tentative")).toBe(EventStatus.Tentative);
		expect(normalizeStatusKey("cancelled")).toBe(EventStatus.Cancelled);
		expect(normalizeStatusKey("bogus")).toBeNull();
		expect(normalizeStatusKey(null)).toBeNull();
		expect(normalizeStatusKey(42)).toBeNull();
		expect(normalizeStatusKey(undefined)).toBeNull();
	});

	it("stores the default (Confirmed) as null so an untouched event carries no key", () => {
		expect(statusToStored(EventStatus.Confirmed)).toBeNull();
		expect(statusToStored(EventStatus.Tentative)).toBe(EventStatus.Tentative);
		expect(statusToStored(EventStatus.Cancelled)).toBe(EventStatus.Cancelled);
	});
});
