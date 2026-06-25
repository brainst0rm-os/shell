import { describe, expect, it } from "vitest";
import { CaptureState, captureActionsFor, deriveCaptureState } from "./capture-state";

describe("deriveCaptureState", () => {
	it("is Empty when nothing captured, idle, no error", () => {
		expect(deriveCaptureState(false, false, false)).toBe(CaptureState.Empty);
	});
	it("is Captured when content is present and idle", () => {
		expect(deriveCaptureState(true, false, false)).toBe(CaptureState.Captured);
	});
	it("is Error when the last attempt failed with nothing stored", () => {
		expect(deriveCaptureState(false, false, true)).toBe(CaptureState.Error);
	});
	it("prefers Capturing while a fetch is in flight, even with content / error", () => {
		expect(deriveCaptureState(false, true, false)).toBe(CaptureState.Capturing);
		expect(deriveCaptureState(true, true, false)).toBe(CaptureState.Capturing);
		expect(deriveCaptureState(false, true, true)).toBe(CaptureState.Capturing);
	});
	it("prefers existing content over a stale error flag", () => {
		// A reload failed but the prior body is intact → still Captured.
		expect(deriveCaptureState(true, false, true)).toBe(CaptureState.Captured);
	});
});

describe("captureActionsFor", () => {
	it("offers a first capture when Empty", () => {
		expect(captureActionsFor(CaptureState.Empty)).toEqual({
			capture: true,
			reload: false,
			forget: false,
		});
	});
	it("offers a retry capture when Error", () => {
		expect(captureActionsFor(CaptureState.Error)).toEqual({
			capture: true,
			reload: false,
			forget: false,
		});
	});
	it("offers reload + forget when Captured", () => {
		expect(captureActionsFor(CaptureState.Captured)).toEqual({
			capture: false,
			reload: true,
			forget: true,
		});
	});
	it("offers nothing while Capturing", () => {
		expect(captureActionsFor(CaptureState.Capturing)).toEqual({
			capture: false,
			reload: false,
			forget: false,
		});
	});
});
