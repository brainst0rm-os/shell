import { afterEach, describe, expect, it } from "vitest";
import { getActiveShortcutRegistry, setActiveShortcutRegistry } from "./active-registry";
import { ShortcutRegistry } from "./shortcut-registry";

afterEach(() => {
	setActiveShortcutRegistry(null);
});

describe("active-registry (6.10b)", () => {
	it("returns null when no registry has been set", () => {
		expect(getActiveShortcutRegistry()).toBeNull();
	});

	it("returns the registry that was last set", () => {
		const reg = new ShortcutRegistry();
		setActiveShortcutRegistry(reg);
		expect(getActiveShortcutRegistry()).toBe(reg);
	});

	it("setting null clears the active registry", () => {
		setActiveShortcutRegistry(new ShortcutRegistry());
		setActiveShortcutRegistry(null);
		expect(getActiveShortcutRegistry()).toBeNull();
	});
});
