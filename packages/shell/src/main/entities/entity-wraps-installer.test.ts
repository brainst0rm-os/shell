import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { generateSymmetricKey } from "../credentials/crypto";
import { generateDeviceX25519 } from "../credentials/device-x25519";
import {
	ENTITY_META_TOP,
	ENTITY_WRAPS_KEY,
	listWraps,
	unwrapDekForRecipient,
} from "../credentials/member-wraps";
import { installEntityWrap } from "./entity-wraps-installer";

function must<T>(v: T | null | undefined, m: string): T {
	if (v == null) throw new Error(m);
	return v;
}

describe("installEntityWrap", () => {
	it("appends one wrap to meta.wraps for the device pubkey", () => {
		const doc = new Y.Doc();
		const dek = generateSymmetricKey();
		const device = generateDeviceX25519();
		installEntityWrap(doc, dek, device.publicKey, "ent_iw");
		const wraps = listWraps(doc);
		expect(wraps.length).toBe(1);
		expect(doc.getMap(ENTITY_META_TOP).get(ENTITY_WRAPS_KEY)).toBeInstanceOf(Y.Array);
	});

	it("is idempotent — second call for same device is a no-op", () => {
		const doc = new Y.Doc();
		const dek = generateSymmetricKey();
		const device = generateDeviceX25519();
		installEntityWrap(doc, dek, device.publicKey, "ent_iw");
		installEntityWrap(doc, dek, device.publicKey, "ent_iw");
		expect(listWraps(doc).length).toBe(1);
	});

	it("installed wrap round-trips back to the original DEK via 10.2 unwrap", () => {
		const doc = new Y.Doc();
		const dek = generateSymmetricKey();
		const device = generateDeviceX25519();
		installEntityWrap(doc, dek, device.publicKey, "ent_iw");
		const wraps = listWraps(doc);
		const recovered = unwrapDekForRecipient(must(wraps[0], "wraps[0]"), device.secretKey, "ent_iw");
		expect(recovered).toEqual(dek);
	});

	it("install for a second device appends a second wrap", () => {
		const doc = new Y.Doc();
		const dek = generateSymmetricKey();
		const a = generateDeviceX25519();
		const b = generateDeviceX25519();
		installEntityWrap(doc, dek, a.publicKey, "ent_iw");
		installEntityWrap(doc, dek, b.publicKey, "ent_iw");
		expect(listWraps(doc).length).toBe(2);
	});

	it("throws on empty entityId", () => {
		const doc = new Y.Doc();
		const dek = generateSymmetricKey();
		const device = generateDeviceX25519();
		expect(() => installEntityWrap(doc, dek, device.publicKey, "")).toThrow(/non-empty/);
	});
});
