import { describe, expect, it } from "vitest";
import { ModelFormat, fitDistance, modelFormatFor, modelFormatLabel } from "./model-view";

describe("modelFormatFor", () => {
	it("resolves by MIME first", () => {
		expect(modelFormatFor("model/gltf-binary", "")).toBe(ModelFormat.Glb);
		expect(modelFormatFor("model/gltf+json", "")).toBe(ModelFormat.Gltf);
		expect(modelFormatFor("model/obj", "")).toBe(ModelFormat.Obj);
		expect(modelFormatFor("text/prs.wavefront-obj", "")).toBe(ModelFormat.Obj);
	});

	it("tolerates a MIME with parameters / casing", () => {
		expect(modelFormatFor("MODEL/GLTF-BINARY; charset=binary", "")).toBe(ModelFormat.Glb);
	});

	it("falls back to the filename extension when the MIME is generic", () => {
		expect(modelFormatFor("application/octet-stream", "chair.glb")).toBe(ModelFormat.Glb);
		expect(modelFormatFor("application/octet-stream", "scene.GLTF")).toBe(ModelFormat.Gltf);
		expect(modelFormatFor("", "teapot.obj")).toBe(ModelFormat.Obj);
	});

	it("returns null for an unknown format", () => {
		expect(modelFormatFor("application/octet-stream", "notes.txt")).toBeNull();
		expect(modelFormatFor("image/png", "photo.png")).toBeNull();
		expect(modelFormatFor("", "")).toBeNull();
	});
});

describe("fitDistance", () => {
	it("pulls the camera back proportionally to the bounding radius", () => {
		const near = fitDistance(1, 50);
		const far = fitDistance(2, 50);
		expect(far).toBeCloseTo(near * 2, 6);
		expect(near).toBeGreaterThan(1);
	});

	it("matches the d = radius / sin(fov/2) geometry with the default margin", () => {
		const radius = 3;
		const fov = 60;
		const expected = (radius / Math.sin((fov * Math.PI) / 360)) * 1.25;
		expect(fitDistance(radius, fov)).toBeCloseTo(expected, 6);
	});

	it("guards a degenerate (zero / negative) radius to a unit fallback", () => {
		expect(fitDistance(0, 50)).toBe(fitDistance(1, 50));
		expect(fitDistance(-5, 50)).toBe(fitDistance(1, 50));
	});

	it("clamps the FOV so an absurd value can't divide by ~zero", () => {
		expect(Number.isFinite(fitDistance(1, 0))).toBe(true);
		expect(Number.isFinite(fitDistance(1, 360))).toBe(true);
	});
});

describe("modelFormatLabel", () => {
	it("gives a human label for every format", () => {
		for (const format of Object.values(ModelFormat)) {
			expect(modelFormatLabel(format).length).toBeGreaterThan(0);
		}
	});
});
