import { describe, expect, it } from "vitest";
import { IconName } from "../ui/icon";
import {
	SHELL_SURFACES,
	ShellSurfaceId,
	isShellSurfaceId,
	shellSurfacePinIconId,
} from "./shell-surfaces";

describe("shell-surfaces registry", () => {
	it("every ShellSurfaceId has a label key + a real interface glyph", () => {
		for (const id of Object.values(ShellSurfaceId)) {
			const meta = SHELL_SURFACES[id];
			expect(meta, `meta for ${id}`).toBeTruthy();
			expect(meta.labelKey.length).toBeGreaterThan(0);
			expect(Object.values(IconName)).toContain(meta.icon);
		}
	});

	it("the Bin surface maps to the bin label + trash glyph", () => {
		expect(SHELL_SURFACES[ShellSurfaceId.Bin]).toEqual({
			labelKey: "shell.bin.title",
			icon: IconName.Trash,
		});
	});
});

describe("isShellSurfaceId", () => {
	it("accepts registered ids, rejects everything else", () => {
		expect(isShellSurfaceId(ShellSurfaceId.Bin)).toBe(true);
		expect(isShellSurfaceId("bin")).toBe(true);
		expect(isShellSurfaceId("settings")).toBe(false);
		expect(isShellSurfaceId(null)).toBe(false);
		expect(isShellSurfaceId(42)).toBe(false);
	});
});

describe("shellSurfacePinIconId", () => {
	it("is deterministic and namespaced away from entity pins (pin_<id>)", () => {
		expect(shellSurfacePinIconId(ShellSurfaceId.Bin)).toBe("pin_surface_bin");
		// Distinct prefix so it can never collide with `pin_<entityId>`.
		expect(shellSurfacePinIconId(ShellSurfaceId.Bin).startsWith("pin_surface_")).toBe(true);
	});
});
