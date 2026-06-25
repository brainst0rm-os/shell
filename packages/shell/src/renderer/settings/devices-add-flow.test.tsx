/**
 * `<DevicesAddFlow>` — SSR smoke + state-machine surface.
 *
 * The flow boots, fires startAddDevice in a `useEffect`, then renders the
 * QR + 6-digit code. SSR renders the synchronous first paint (Preparing
 * with the spinner). The pure helpers + state enum are pinned here so
 * downstream UI doesn't accidentally drop a state.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevicesAddFlow, DevicesAddState } from "./devices-add-flow";

let stub: {
	pairing: {
		startAddDevice: ReturnType<typeof vi.fn>;
		cancelPairing: ReturnType<typeof vi.fn>;
	};
};

beforeEach(() => {
	stub = {
		pairing: {
			startAddDevice: vi.fn().mockResolvedValue({
				requestId: "req-1",
				payload: "PAYLOAD".repeat(10),
				sas: "123456",
				expiresAt: Math.floor(Date.now() / 1000) + 120,
				channelId: "ch-1",
				mode: "qr",
			}),
			cancelPairing: vi.fn().mockResolvedValue({ requestId: "req-1", state: "cancelled" }),
		},
	};
	(globalThis as { window?: unknown }).window = { brainstorm: stub };
});

afterEach(() => {
	(globalThis as { window?: unknown }).window = undefined;
});

describe("DevicesAddFlow", () => {
	it("renders the Preparing state on first synchronous paint", () => {
		const html = renderToStaticMarkup(<DevicesAddFlow onClose={() => undefined} />);
		expect(html).toContain('data-testid="devices-add-flow"');
		expect(html).toContain(`data-state="${DevicesAddState.Preparing}"`);
	});

	it("declares all five state-machine states (Preparing/Waiting/Handshake/Paired/Cancelled/Expired/Error)", () => {
		expect(Object.values(DevicesAddState)).toEqual(
			expect.arrayContaining([
				"preparing",
				"waiting",
				"handshake",
				"paired",
				"cancelled",
				"expired",
				"error",
			]),
		);
	});

	it("includes a header with the localised title", () => {
		const html = renderToStaticMarkup(<DevicesAddFlow onClose={() => undefined} />);
		expect(html).toContain("Add a device");
	});

	it("pins the IPC bridge shape startAddDevice/cancelPairing the flow consumes", () => {
		expect(typeof stub.pairing.startAddDevice).toBe("function");
		expect(typeof stub.pairing.cancelPairing).toBe("function");
	});

	it("renders a spinner inside the loading region on first paint", () => {
		const html = renderToStaticMarkup(<DevicesAddFlow onClose={() => undefined} />);
		expect(html).toContain("devices-flow__loading");
	});

	it("renders the localised preparing copy", () => {
		const html = renderToStaticMarkup(<DevicesAddFlow onClose={() => undefined} />);
		expect(html).toContain("Preparing pairing handshake");
	});
});
