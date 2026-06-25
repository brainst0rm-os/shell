import { describe, expect, it } from "vitest";
import {
	claimAutomationHost,
	designationToProperties,
	propertiesToDesignation,
	shouldRunScheduler,
	takeOverAutomationHost,
} from "./automation-host-designation";

const DEVICE_A = "ed25519:aaaa";
const DEVICE_B = "ed25519:bbbb";

describe("shouldRunScheduler", () => {
	it("runs everywhere while no designation exists (single-device default)", () => {
		expect(shouldRunScheduler(null, DEVICE_A)).toBe(true);
		expect(shouldRunScheduler(null, DEVICE_B)).toBe(true);
	});

	it("runs only on the designated device once one exists", () => {
		const designation = claimAutomationHost(DEVICE_A, 100);
		expect(shouldRunScheduler(designation, DEVICE_A)).toBe(true);
		expect(shouldRunScheduler(designation, DEVICE_B)).toBe(false);
	});
});

describe("claim / takeover", () => {
	it("claim stamps the device and the time", () => {
		expect(claimAutomationHost(DEVICE_A, 42)).toEqual({ deviceId: DEVICE_A, claimedAt: 42 });
	});

	it("takeover moves hosting to the taking device", () => {
		const before = claimAutomationHost(DEVICE_A, 1);
		const after = takeOverAutomationHost(before, DEVICE_B, 2);
		expect(shouldRunScheduler(after, DEVICE_A)).toBe(false);
		expect(shouldRunScheduler(after, DEVICE_B)).toBe(true);
		expect(after.claimedAt).toBe(2);
	});
});

describe("persistence codec", () => {
	it("round-trips", () => {
		const designation = claimAutomationHost(DEVICE_A, 7);
		expect(propertiesToDesignation(designationToProperties(designation))).toEqual(designation);
	});

	it("malformed bags read as no designation (fail-open to single-device)", () => {
		expect(propertiesToDesignation(null)).toBeNull();
		expect(propertiesToDesignation("x")).toBeNull();
		expect(propertiesToDesignation([])).toBeNull();
		expect(propertiesToDesignation({ deviceId: "" })).toBeNull();
		expect(propertiesToDesignation({ deviceId: DEVICE_A })).toBeNull();
		expect(propertiesToDesignation({ deviceId: DEVICE_A, claimedAt: Number.NaN })).toBeNull();
		// And fail-open means: a vault with a corrupt designation still runs.
		expect(shouldRunScheduler(propertiesToDesignation({ bad: true }), DEVICE_B)).toBe(true);
	});
});
