/**
 * `<DevicesList>` — pure render unit tests. The list is sort + per-row
 * affordances + revoke-button gating; no live IPC, no async state.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SignedAddDeviceRecord } from "../../preload";
import { DevicesList, sortDevices } from "./devices-list";

function record(partial: Partial<SignedAddDeviceRecord> & { id: string }): SignedAddDeviceRecord {
	return {
		deviceEd25519Pub: partial.deviceEd25519Pub ?? `pub-${partial.id}`,
		deviceX25519Pub: partial.deviceX25519Pub ?? `x25519-${partial.id}`,
		deviceLabel: partial.deviceLabel ?? `Device ${partial.id}`,
		addedAt: partial.addedAt ?? 1_000_000,
		addedBy: partial.addedBy ?? "signer",
		sig: partial.sig ?? "sig",
		...(partial.revokedAt !== undefined ? { revokedAt: partial.revokedAt } : {}),
	};
}

describe("sortDevices", () => {
	it("orders newest-first by addedAt", () => {
		const sorted = sortDevices([
			record({ id: "a", addedAt: 100 }),
			record({ id: "b", addedAt: 300 }),
			record({ id: "c", addedAt: 200 }),
		]);
		expect(sorted.map((r) => r.deviceLabel)).toEqual(["Device b", "Device c", "Device a"]);
	});
});

describe("DevicesList", () => {
	it("renders one row per record with the paired-at date string", () => {
		const html = renderToStaticMarkup(
			<DevicesList
				records={[record({ id: "a" })]}
				thisDeviceEd25519Pub={null}
				onRevoke={() => undefined}
			/>,
		);
		expect(html).toContain('data-testid="devices-list"');
		expect(html).toContain("Device a");
		// The IntlDateTimeFormat may localise; assert it produces a recognisable year token.
		expect(html).toMatch(/1970|0001-/);
	});

	it("hides the revoke button on the this-device row and on revoked rows", () => {
		const html = renderToStaticMarkup(
			<DevicesList
				records={[
					record({ id: "a", deviceEd25519Pub: "pub-a" }),
					record({ id: "b", deviceEd25519Pub: "pub-b", revokedAt: 999 }),
				]}
				thisDeviceEd25519Pub="pub-a"
				onRevoke={() => undefined}
			/>,
		);
		// Neither row's revoke button should be present.
		expect(html).not.toContain("devices-list-revoke-pub-a");
		expect(html).not.toContain("devices-list-revoke-pub-b");
		// Revoked row carries the modifier class + badge.
		expect(html).toContain("devices-list__row--revoked");
		expect(html).toContain("devices-list__badge--revoked");
	});

	it("renders a revoke icon button on third-party rows", () => {
		const html = renderToStaticMarkup(
			<DevicesList
				records={[record({ id: "x", deviceEd25519Pub: "pub-other" })]}
				thisDeviceEd25519Pub="pub-self"
				onRevoke={() => undefined}
			/>,
		);
		expect(html).toContain("devices-list-revoke-pub-ot");
	});
});
