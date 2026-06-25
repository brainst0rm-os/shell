import { describe, expect, it } from "vitest";
import { SPAWN_CASCADE_STEP, SPAWN_OCCUPIED_EPSILON, resolveSpawnPoint } from "./spawn-position";

describe("resolveSpawnPoint", () => {
	it("returns the preferred point unchanged when the board is empty", () => {
		expect(resolveSpawnPoint({ x: 120, y: 80 }, [])).toEqual({ x: 120, y: 80 });
	});

	it("returns the preferred point when no node origin is near it", () => {
		const obstacles = [
			{ x: 0, y: 0 },
			{ x: 400, y: 400 },
		];
		expect(resolveSpawnPoint({ x: 120, y: 80 }, obstacles)).toEqual({ x: 120, y: 80 });
	});

	it("cascades one step down-right when the spot is occupied", () => {
		const obstacles = [{ x: 120, y: 80 }];
		expect(resolveSpawnPoint({ x: 120, y: 80 }, obstacles)).toEqual({
			x: 120 + SPAWN_CASCADE_STEP,
			y: 80 + SPAWN_CASCADE_STEP,
		});
	});

	it("treats near-identical origins (within epsilon) as occupied", () => {
		const nudge = SPAWN_OCCUPIED_EPSILON - 1;
		const obstacles = [{ x: 120 + nudge, y: 80 - nudge }];
		expect(resolveSpawnPoint({ x: 120, y: 80 }, obstacles)).toEqual({
			x: 120 + SPAWN_CASCADE_STEP,
			y: 80 + SPAWN_CASCADE_STEP,
		});
	});

	it("keeps cascading past an existing cascade chain (no two creates land together)", () => {
		// Simulates the dogfood failure: repeated creates with a stationary
		// camera. Each resolved point becomes an obstacle for the next.
		const obstacles: Array<{ x: number; y: number }> = [];
		const seen = new Set<string>();
		for (let i = 0; i < 8; i++) {
			const p = resolveSpawnPoint({ x: 200, y: 200 }, obstacles);
			const key = `${p.x},${p.y}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
			obstacles.push(p);
		}
		expect(seen.size).toBe(8);
	});

	it("terminates on a pathological fully-occupied diagonal", () => {
		const obstacles = Array.from({ length: 1000 }, (_, i) => ({
			x: i * SPAWN_CASCADE_STEP,
			y: i * SPAWN_CASCADE_STEP,
		}));
		const p = resolveSpawnPoint({ x: 0, y: 0 }, obstacles);
		expect(Number.isFinite(p.x)).toBe(true);
		expect(Number.isFinite(p.y)).toBe(true);
	});
});
