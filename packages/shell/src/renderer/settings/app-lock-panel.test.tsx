// @vitest-environment jsdom
/**
 * Stage 13.8 surface (slice 2) — `<AppLockPanel>` behaviour.
 *
 * Drives the Settings → Security app-lock UI against a faked `vault:*` bridge:
 * status reflects `hasPin`, the set/change form (now opened in a `<Popover>`,
 * so it portals to `document.body`, not under the mount host) validates (6
 * digits + match) before calling `setPin`, "Lock now" calls `lock`, and removal
 * confirms then calls `clearPin`. The keystore round-trip itself is covered by
 * the handler tests; this pins the renderer wiring + validation.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLockPanel } from "./app-lock-panel";

vi.mock("../ui/confirm", () => ({
	ConfirmVariant: { Destructive: "destructive" },
	confirm: vi.fn().mockResolvedValue(true),
}));
import { confirm } from "../ui/confirm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("AppLockPanel", () => {
	let host: HTMLDivElement;
	let root: Root;
	let hasPin: Mock<() => Promise<boolean>>;
	let setPin: Mock<(pin: string) => Promise<boolean>>;
	let clearPin: Mock<() => Promise<boolean>>;
	let lock: Mock<() => Promise<{ locked: boolean }>>;

	beforeEach(() => {
		hasPin = vi.fn().mockResolvedValue(false);
		setPin = vi.fn().mockResolvedValue(true);
		clearPin = vi.fn().mockResolvedValue(true);
		lock = vi.fn().mockResolvedValue({ locked: true });
		(window as unknown as { brainstorm: unknown }).brainstorm = {
			vaults: { hasPin, setPin, clearPin, lock },
		};
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		(confirm as unknown as Mock).mockResolvedValue(true);
	});

	afterEach(() => {
		act(() => root.unmount());
		host.remove();
		(window as unknown as { brainstorm?: unknown }).brainstorm = undefined;
		vi.clearAllMocks();
	});

	const mount = async () => {
		act(() => root.render(<AppLockPanel />));
		await act(async () => {});
	};
	// The section buttons (Set/Change/Lock/Remove) stay under `host`; the PIN
	// form + its error live in the popover, which portals to `document.body`.
	const btn = (label: string) =>
		[...host.querySelectorAll("button")].find((b) => b.textContent === label) ?? null;
	const popover = () => document.querySelector('[data-testid="app-lock-pin-popover"]');
	const boxes = () =>
		[...(popover()?.querySelectorAll(".pin-input__box") ?? [])] as HTMLInputElement[];
	const popError = () => popover()?.querySelector(".app-lock__error")?.textContent ?? null;
	// Two PinInputs render in order: boxes 0–5 = PIN, 6–11 = confirm. Type the
	// digits into the group starting at `offset`.
	const typePin = (offset: number, digits: string) => {
		for (let i = 0; i < digits.length; i++) {
			const box = boxes()[offset + i];
			if (!box) continue;
			act(() => {
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
				setter?.call(box, digits[i]);
				box.dispatchEvent(new Event("input", { bubbles: true }));
			});
		}
	};
	const submitForm = () =>
		act(() =>
			popover()
				?.querySelector(".app-lock__form")
				?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
		);

	it("shows the no-PIN status + a Set PIN affordance", async () => {
		await mount();
		expect(host.querySelector(".app-lock__status")?.textContent).toBe("No PIN set.");
		expect(btn("Set PIN")).not.toBeNull();
		expect(btn("Remove PIN")).toBeNull();
	});

	it("shows PIN-on status + Change/Lock/Remove when a PIN exists", async () => {
		hasPin.mockResolvedValue(true);
		await mount();
		expect(host.querySelector(".app-lock__status")?.textContent).toBe("PIN lock is on.");
		expect(btn("Change PIN")).not.toBeNull();
		expect(btn("Lock now")).not.toBeNull();
		expect(btn("Remove PIN")).not.toBeNull();
	});

	it("rejects an incomplete (non-6-digit) PIN without calling setPin", async () => {
		await mount();
		act(() => btn("Set PIN")?.click());
		typePin(0, "1234");
		typePin(6, "1234");
		await submitForm();
		expect(setPin).not.toHaveBeenCalled();
		expect(popError()).toBe("Enter a 6-digit PIN.");
	});

	it("rejects mismatched PINs without calling setPin", async () => {
		await mount();
		act(() => btn("Set PIN")?.click());
		typePin(0, "123456");
		typePin(6, "654321");
		await submitForm();
		expect(setPin).not.toHaveBeenCalled();
		expect(popError()).toBe("PINs don't match.");
	});

	it("saves a valid matching PIN via the bridge", async () => {
		await mount();
		act(() => btn("Set PIN")?.click());
		typePin(0, "123456");
		typePin(6, "123456");
		await submitForm();
		expect(setPin).toHaveBeenCalledWith("123456");
	});

	it("Lock now calls vaults.lock", async () => {
		hasPin.mockResolvedValue(true);
		await mount();
		act(() => btn("Lock now")?.click());
		expect(lock).toHaveBeenCalledTimes(1);
	});

	it("Remove confirms then calls clearPin", async () => {
		hasPin.mockResolvedValue(true);
		await mount();
		await act(async () => btn("Remove PIN")?.click());
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(clearPin).toHaveBeenCalledTimes(1);
	});
});
