/**
 * Stage 10.3a — install the per-device member wrap on an entity's Y.Doc.
 *
 * On `entities.create` (and the legacy-null-DEK drain in `retroWrapNullDeks`),
 * the wire path needs the entity's Y.Doc to carry exactly one
 * `MemberWrapPayload` addressed to *this device's* X25519 pubkey. A new
 * device joining a single-user multi-device session will (10.3b's
 * `WrapBootstrap`) emit additional wraps for each paired device; v1 single-
 * device always has exactly one wrap.
 *
 * **Idempotent**: a second call for the same device on the same doc is a
 * no-op (no second wrap appended, no extra Yjs update). The installer
 * detects an existing wrap by `findWrapForRecipient` BEFORE minting a new
 * HPKE encapsulation — important because the encapsulation generates a
 * fresh ephemeral X25519 keypair on every call, so appending blindly
 * would write a different (but valid) wrap for the same device every
 * time.
 *
 * Ladder contract: this module is the only producer of `MemberWrapPayload`
 * entries on entity Y.Docs in 10.3a. 10.3b's `WrapBootstrap` envelope kind
 * will route wrap-installation across paired devices through the wire
 * path; the installer here stays the same — it just gains a second caller.
 */

import type * as Y from "yjs";
import { appendWrap, findWrapForRecipient, wrapDekForRecipient } from "../credentials/member-wraps";

/** Install a member wrap addressed to `devicePubX25519` on `doc`. Mints
 *  the wrap via HPKE if no existing entry matches the device pubkey;
 *  no-op when the wrap is already present (idempotent across re-opens). */
export function installEntityWrap(
	doc: Y.Doc,
	dek: Uint8Array,
	devicePubX25519: Uint8Array,
	entityId: string,
	type?: string,
): void {
	assertNonEmptyEntityId(entityId);
	if (findWrapForRecipient(doc, devicePubX25519)) return;
	const wrap = wrapDekForRecipient(dek, devicePubX25519, entityId, type);
	appendWrap(doc, wrap);
}

function assertNonEmptyEntityId(entityId: string): void {
	if (entityId === "") throw new Error("installEntityWrap: entityId must be non-empty");
}
