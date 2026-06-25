// @vitest-environment jsdom
/**
 * `<DevicesSection>` — three-state section (idle list / add-flow / join-flow).
 * The add/join flows now overlay the device list in the shared `<Popover>`
 * (which uses framer-motion + portals to `document.body`), so this is driven
 * under jsdom: mount synchronously to catch the loading paint, then assert the
 * routed flow renders into the popover via `initialView`.
 */

import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedAddDeviceRecord } from "../../preload";
import { DevicesSection, DevicesViewState } from "./devices-section";

type StubPairing = {
	listDevices: ReturnType<typeof vi.fn>;
	thisDeviceFingerprint: ReturnType<typeof vi.fn>;
	hasRelay: ReturnType<typeof vi.fn>;
	revokeDevice: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	startAddDevice: ReturnType<typeof vi.fn>;
	scanPayload: ReturnType<typeof vi.fn>;
	confirmSas: ReturnType<typeof vi.fn>;
	cancelPairing: ReturnType<typeof vi.fn>;
};

let stub: { pairing: StubPairing };
let host: HTMLDivElement;
let root: Root;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
	stub = {
		pairing: {
			listDevices: vi.fn().mockResolvedValue({ records: [] as SignedAddDeviceRecord[] }),
			thisDeviceFingerprint: vi.fn().mockResolvedValue(null),
			hasRelay: vi.fn().mockResolvedValue(true),
			revokeDevice: vi.fn().mockResolvedValue({ revoked: true }),
			on: vi.fn().mockReturnValue(() => undefined),
			startAddDevice: vi
				.fn()
				.mockResolvedValue({ requestId: "req", payload: "p", sas: "123456", expiresAt: 0 }),
			scanPayload: vi.fn(),
			confirmSas: vi.fn(),
			cancelPairing: vi.fn().mockResolvedValue(undefined),
		},
	};
	(window as unknown as { brainstorm: unknown }).brainstorm = stub;
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	(window as unknown as { brainstorm?: unknown }).brainstorm = undefined;
	vi.clearAllMocks();
});

describe("DevicesSection", () => {
	it("renders the loading placeholder on first synchronous paint", () => {
		// Render without flushing the async bridge — `loading` is still true.
		act(() => root.render(<DevicesSection />));
		expect(host.querySelector(".settings__placeholder")).not.toBeNull();
	});

	it("subscribes to the pairing change channel on mount", async () => {
		await act(async () => root.render(<DevicesSection />));
		expect(stub.pairing.on).toHaveBeenCalledTimes(1);
		expect(stub.pairing.listDevices).toHaveBeenCalled();
	});

	it("routes into the add-device flow when initialView is Add", () => {
		act(() => root.render(<DevicesSection initialView={DevicesViewState.Add} />));
		expect(document.querySelector('[data-testid="devices-add-flow"]')).not.toBeNull();
	});

	it("routes into the join-vault flow when initialView is Join", () => {
		act(() => root.render(<DevicesSection initialView={DevicesViewState.Join} />));
		expect(document.querySelector('[data-testid="devices-join-flow"]')).not.toBeNull();
	});

	it("defaults to the List view (no pairing flow open)", () => {
		act(() => root.render(<DevicesSection />));
		expect(document.querySelector('[data-testid="devices-add-flow"]')).toBeNull();
		expect(document.querySelector('[data-testid="devices-join-flow"]')).toBeNull();
	});
});
