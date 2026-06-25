/**
 * `<DevicesJoinFlow>` — target-side flow tests.
 *
 * Pure helper tests plus an SSR smoke render that pins the first-paint
 * surface (capture state + tabs). The interactive state machine
 * (scan/paste → confirm-sas → joining → joined) rides on `useState` +
 * `useCallback`; React Testing Library would only retest hook plumbing.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DevicesJoinFlow,
	DevicesJoinState,
	DevicesJoinTab,
	isBarcodeDetectorAvailable,
	isPlausiblePairingPayload,
} from "./devices-join-flow";

let stub: {
	pairing: {
		scanPayload: ReturnType<typeof vi.fn>;
		confirmSas: ReturnType<typeof vi.fn>;
		cancelPairing: ReturnType<typeof vi.fn>;
	};
};

beforeEach(() => {
	stub = {
		pairing: {
			scanPayload: vi.fn().mockResolvedValue({
				requestId: "req-x",
				sas: "654321",
				channelId: "ch-x",
				expiresAt: Math.floor(Date.now() / 1000) + 60,
				mode: "qr",
			}),
			confirmSas: vi.fn().mockResolvedValue({
				requestId: "req-x",
				addedRecord: {
					deviceEd25519Pub: "p",
					deviceX25519Pub: "x",
					deviceLabel: "d",
					addedAt: 0,
					addedBy: "u",
					sig: "s",
				},
			}),
			cancelPairing: vi.fn().mockResolvedValue({ requestId: "req-x", state: "cancelled" }),
		},
	};
	(globalThis as { window?: unknown }).window = { brainstorm: stub };
});

afterEach(() => {
	(globalThis as { window?: unknown }).window = undefined;
});

describe("isPlausiblePairingPayload", () => {
	it("accepts a base64url-shaped string of plausible length", () => {
		const valid = `${"A".repeat(40)}_-`;
		expect(isPlausiblePairingPayload(valid)).toBe(true);
	});

	it("rejects empty / too-short strings", () => {
		expect(isPlausiblePairingPayload("")).toBe(false);
		expect(isPlausiblePairingPayload("abc")).toBe(false);
	});

	it("rejects payloads with non-base64url characters", () => {
		expect(isPlausiblePairingPayload(`${"A".repeat(40)} oops`)).toBe(false);
		expect(isPlausiblePairingPayload(`${"A".repeat(40)}/+`)).toBe(false);
	});

	it("rejects unbounded oversize payloads", () => {
		expect(isPlausiblePairingPayload("A".repeat(5000))).toBe(false);
	});
});

describe("isBarcodeDetectorAvailable", () => {
	const KEY = "BarcodeDetector";
	const had = KEY in globalThis;
	const original = (globalThis as Record<string, unknown>)[KEY];

	afterEach(() => {
		if (!had) {
			Reflect.deleteProperty(globalThis, KEY);
		} else {
			(globalThis as Record<string, unknown>)[KEY] = original;
		}
	});

	it("returns false when the platform API is missing", () => {
		Reflect.deleteProperty(globalThis, KEY);
		expect(isBarcodeDetectorAvailable()).toBe(false);
	});

	it("returns true when the platform API is available", () => {
		(globalThis as Record<string, unknown>)[KEY] = class {};
		expect(isBarcodeDetectorAvailable()).toBe(true);
	});
});

describe("DevicesJoinFlow", () => {
	it("renders the capture state by default with both tabs", () => {
		const html = renderToStaticMarkup(<DevicesJoinFlow onClose={() => undefined} />);
		expect(html).toContain('data-testid="devices-join-flow"');
		expect(html).toContain(`data-state="${DevicesJoinState.Capture}"`);
		expect(html).toContain('data-testid="devices-join-tab-scan"');
		expect(html).toContain('data-testid="devices-join-tab-paste"');
	});

	it("declares both join tabs", () => {
		expect(Object.values(DevicesJoinTab)).toEqual(["scan", "paste"]);
	});

	it("declares every join-state value the renderer switches on", () => {
		expect(Object.values(DevicesJoinState)).toEqual(
			expect.arrayContaining([
				"capture",
				"confirm-sas",
				"joining",
				"joined",
				"cancelled",
				"expired",
				"error",
			]),
		);
	});
});
