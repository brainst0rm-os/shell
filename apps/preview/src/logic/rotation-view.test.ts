import { describe, expect, it } from "vitest";
import {
	type Angle,
	RotationDirection,
	effectiveSize,
	flipScaleFactors,
	isQuarterTurned,
	normalizeAngle,
	rotateBy,
} from "./rotation-view";

describe("normalizeAngle", () => {
	it("snaps to the nearest legal angle and wraps into [0,360)", () => {
		expect(normalizeAngle(0)).toBe(0);
		expect(normalizeAngle(90)).toBe(90);
		expect(normalizeAngle(360)).toBe(0);
		expect(normalizeAngle(450)).toBe(90);
		expect(normalizeAngle(-90)).toBe(270);
		expect(normalizeAngle(-270)).toBe(90);
	});
	it("rounds an off-axis value to the nearest quarter turn", () => {
		expect(normalizeAngle(44)).toBe(0);
		expect(normalizeAngle(46)).toBe(90);
	});
});

describe("rotateBy", () => {
	it("cycles clockwise on Right: 0 → 90 → 180 → 270 → 0", () => {
		let a: Angle = 0;
		const seq: Angle[] = [];
		for (let i = 0; i < 4; i++) {
			a = rotateBy(a, RotationDirection.Right);
			seq.push(a);
		}
		expect(seq).toEqual([90, 180, 270, 0]);
	});
	it("cycles counter-clockwise on Left: 0 → 270 → 180 → 90 → 0", () => {
		let a: Angle = 0;
		const seq: Angle[] = [];
		for (let i = 0; i < 4; i++) {
			a = rotateBy(a, RotationDirection.Left);
			seq.push(a);
		}
		expect(seq).toEqual([270, 180, 90, 0]);
	});
	it("Left then Right returns to the start", () => {
		expect(rotateBy(rotateBy(90, RotationDirection.Left), RotationDirection.Right)).toBe(90);
	});
});

describe("isQuarterTurned", () => {
	it("is true only at 90° and 270°", () => {
		expect(isQuarterTurned(0)).toBe(false);
		expect(isQuarterTurned(90)).toBe(true);
		expect(isQuarterTurned(180)).toBe(false);
		expect(isQuarterTurned(270)).toBe(true);
		expect(isQuarterTurned(-90)).toBe(true);
	});
});

describe("effectiveSize", () => {
	const natural = { w: 800, h: 600 };
	it("keeps the box at 0° and 180°", () => {
		expect(effectiveSize(natural, 0)).toEqual({ w: 800, h: 600 });
		expect(effectiveSize(natural, 180)).toEqual({ w: 800, h: 600 });
	});
	it("swaps width/height at 90° and 270°", () => {
		expect(effectiveSize(natural, 90)).toEqual({ w: 600, h: 800 });
		expect(effectiveSize(natural, 270)).toEqual({ w: 600, h: 800 });
	});
});

describe("flipScaleFactors", () => {
	it("is identity when neither axis is flipped", () => {
		expect(flipScaleFactors(false, false)).toEqual({ sx: 1, sy: 1 });
	});
	it("mirrors x for horizontal, y for vertical, both for both", () => {
		expect(flipScaleFactors(true, false)).toEqual({ sx: -1, sy: 1 });
		expect(flipScaleFactors(false, true)).toEqual({ sx: 1, sy: -1 });
		expect(flipScaleFactors(true, true)).toEqual({ sx: -1, sy: -1 });
	});
});
