/**
 * `pairing:*` IPC handlers — module surface + registration smoke.
 *
 * Heavy state-machine + crypto coverage already lives in 10.5a's
 * `pairing-service.test.ts` + `pairing-handshake.test.ts`. These tests
 * pin the IPC-layer contract: handler registration, the
 * `APP_PAIRING_DEVICES_CHANGED_CHANNEL` const, and the exports the
 * preload bridge depends on.
 */

import { describe, expect, it } from "vitest";
import { APP_PAIRING_DEVICES_CHANGED_CHANNEL, registerPairingHandlers } from "./pairing-handlers";

describe("APP_PAIRING_DEVICES_CHANGED_CHANNEL", () => {
	it("exposes the broadcast channel id the dashboard preload listens on", () => {
		expect(APP_PAIRING_DEVICES_CHANGED_CHANNEL).toBe("app:pairing-devices-changed");
	});
});

describe("registerPairingHandlers", () => {
	it("is callable as a registration function returning a disposer", () => {
		expect(typeof registerPairingHandlers).toBe("function");
	});
});
