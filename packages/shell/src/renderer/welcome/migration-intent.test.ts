import { afterEach, describe, expect, it } from "vitest";
import { consumeMigrationImport, requestMigrationImport } from "./migration-intent";

// Drain any set flag between tests so one case can't leak into the next.
afterEach(() => {
	consumeMigrationImport();
});

describe("migration-intent one-shot (IE-3)", () => {
	it("is unset by default", () => {
		expect(consumeMigrationImport()).toBe(false);
	});

	it("returns true exactly once after a request, then clears", () => {
		requestMigrationImport();
		expect(consumeMigrationImport()).toBe(true);
		expect(consumeMigrationImport()).toBe(false);
	});

	it("collapses repeated requests into a single consumable signal", () => {
		requestMigrationImport();
		requestMigrationImport();
		expect(consumeMigrationImport()).toBe(true);
		expect(consumeMigrationImport()).toBe(false);
	});
});
