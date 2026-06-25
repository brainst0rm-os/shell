import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusStealingDisabled, revealWindow } from "./reveal-window";

afterEach(() => {
	vi.unstubAllEnvs();
});

function fakeWindow(destroyed = false) {
	return {
		isDestroyed: () => destroyed,
		show: vi.fn(),
		showInactive: vi.fn(),
	} as unknown as BrowserWindow;
}

describe("focusStealingDisabled", () => {
	it("is false by default", () => {
		vi.stubEnv("BRAINSTORM_NO_FOCUS", "");
		vi.stubEnv("BRAINSTORM_SOAK_DEBUG", "");
		expect(focusStealingDisabled()).toBe(false);
	});

	it("is true under BRAINSTORM_NO_FOCUS", () => {
		vi.stubEnv("BRAINSTORM_NO_FOCUS", "1");
		vi.stubEnv("BRAINSTORM_SOAK_DEBUG", "");
		expect(focusStealingDisabled()).toBe(true);
	});

	it("is true under BRAINSTORM_SOAK_DEBUG", () => {
		vi.stubEnv("BRAINSTORM_NO_FOCUS", "");
		vi.stubEnv("BRAINSTORM_SOAK_DEBUG", "1");
		expect(focusStealingDisabled()).toBe(true);
	});
});

describe("revealWindow", () => {
	it("activates with show() when focus-stealing is allowed", () => {
		vi.stubEnv("BRAINSTORM_NO_FOCUS", "");
		vi.stubEnv("BRAINSTORM_SOAK_DEBUG", "");
		const win = fakeWindow();
		revealWindow(win);
		expect(win.show).toHaveBeenCalledOnce();
		expect(win.showInactive).not.toHaveBeenCalled();
	});

	it("reveals without activating under the no-focus flag", () => {
		vi.stubEnv("BRAINSTORM_NO_FOCUS", "1");
		const win = fakeWindow();
		revealWindow(win);
		expect(win.showInactive).toHaveBeenCalledOnce();
		expect(win.show).not.toHaveBeenCalled();
	});

	it("no-ops on a destroyed window", () => {
		vi.stubEnv("BRAINSTORM_NO_FOCUS", "1");
		const win = fakeWindow(true);
		revealWindow(win);
		expect(win.show).not.toHaveBeenCalled();
		expect(win.showInactive).not.toHaveBeenCalled();
	});
});
