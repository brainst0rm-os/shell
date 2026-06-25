/**
 * Collab C4 — two-vault collaboration scenarios on the in-process harness.
 *
 * Where C3 (`two-user-share.test.ts`) proves the raw wire path step by step,
 * these read as the dogfood story: Mira (owner) and Marcus (collaborator) on
 * two vaults over a local relay, sharing a brief, co-editing it, and Mira later
 * revoking access — the hiring/collaboration arc the founder loop will drive.
 * All deterministic and in-process; the Electron two-shell variant over a real
 * relay is Collab-C4-live.
 */

import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessRole, resolveMembers } from "./access-record";
import { CollabLink } from "./collab-harness";

const BRIEF = "ent_northbound_brief";
const NOTE_TYPE = "brainstorm/Note/v1";

describe("collab C4 — Mira ↔ Marcus two-vault scenarios", () => {
	let dirMira: string;
	let dirMarcus: string;
	let link: CollabLink;

	beforeEach(async () => {
		dirMira = await mkdtemp(join(tmpdir(), "bs-c4-mira-"));
		dirMarcus = await mkdtemp(join(tmpdir(), "bs-c4-marcus-"));
		link = await CollabLink.create({
			owner: { label: "Mira", vaultId: "vlt_mira", vaultPath: dirMira },
			collaborator: { label: "Marcus", vaultId: "vlt_marcus", vaultPath: dirMarcus },
		});
	});

	afterEach(async () => {
		link.dispose();
		await rm(dirMira, { recursive: true, force: true });
		await rm(dirMarcus, { recursive: true, force: true });
	});

	it("Mira shares a brief; Marcus reads it, is an active Editor, and both co-edit to convergence", async () => {
		// Distinct people, not two devices of one person.
		expect(link.owner.userPubB64).not.toBe(link.collaborator.userPubB64);

		const briefDoc = await link.owner.provisionEntity(BRIEF, NOTE_TYPE);
		briefDoc.getText("body").insert(0, "Northbound brand brief: voice, palette, type. ");

		const invite = link.collaborator.invite("Marcus — designer");
		await link.share({ entityId: BRIEF, type: NOTE_TYPE, invite, role: AccessRole.Editor });

		// Marcus can read Mira's content and sees a real, active Editor grant.
		const marcusDoc = link.collaborator.docs.get(BRIEF);
		expect(marcusDoc?.getText("body").toString()).toContain("brand brief");
		expect(link.collaborator.isActiveMember(BRIEF, link.collaborator.userPubB64)).toBe(true);
		expect(link.collaborator.roleOf(BRIEF, link.collaborator.userPubB64)).toBe(AccessRole.Editor);

		// Both edit concurrently; the docs converge.
		link.wireLiveSync(BRIEF);
		briefDoc.getText("body").insert(briefDoc.getText("body").length, "[Mira: ship Friday]");
		marcusDoc?.getText("body").insert(marcusDoc.getText("body").length, "[Marcus: logo v2 attached]");
		await link.awaitConverged(BRIEF);

		const finalText = briefDoc.getText("body").toString();
		expect(marcusDoc?.getText("body").toString()).toBe(finalText);
		expect(finalText).toContain("[Mira: ship Friday]");
		expect(finalText).toContain("[Marcus: logo v2 attached]");
	});

	it("Mira revokes Marcus; he is no longer active but the grant→revoke history is retained", async () => {
		const briefDoc = await link.owner.provisionEntity(BRIEF, NOTE_TYPE);
		briefDoc.getText("body").insert(0, "Confidential pricing model. ");
		const invite = link.collaborator.invite("Marcus");
		await link.share({ entityId: BRIEF, type: NOTE_TYPE, invite, role: AccessRole.Editor });
		link.wireLiveSync(BRIEF);

		expect(link.collaborator.isActiveMember(BRIEF, link.collaborator.userPubB64)).toBe(true);

		// Mira revokes; the revoke is a signed, append-only mutation that syncs.
		const revoked = link.revoke(BRIEF, link.collaborator.userPubB64);
		expect(revoked).toBe(true);
		await link.awaitConverged(BRIEF);

		// Marcus is no longer an active member on his own synced copy.
		expect(link.collaborator.isActiveMember(BRIEF, link.collaborator.userPubB64)).toBe(false);
		expect(link.collaborator.roleOf(BRIEF, link.collaborator.userPubB64)).toBeNull();

		// The audit history survives on both sides: one entry, grant valid, now
		// validly revoked — "who had access between X and Y" is still answerable.
		const marcusDoc = link.collaborator.docs.get(BRIEF);
		if (!marcusDoc) throw new Error("expected Marcus brief doc");
		const history = resolveMembers(marcusDoc, BRIEF).filter(
			(m) => m.member === link.collaborator.userPubB64,
		);
		expect(history).toHaveLength(1);
		expect(history[0]?.grantValid).toBe(true);
		expect(history[0]?.revokeValid).toBe(true);
		expect(history[0]?.active).toBe(false);
		expect(history[0]?.revokedBy).toBe(link.owner.userPubB64);
	});

	it("a Viewer-role share lands Marcus as a Viewer, not an Editor", async () => {
		await link.owner.provisionEntity(BRIEF, NOTE_TYPE);
		const invite = link.collaborator.invite("Marcus");
		await link.share({ entityId: BRIEF, type: NOTE_TYPE, invite, role: AccessRole.Viewer });
		expect(link.collaborator.roleOf(BRIEF, link.collaborator.userPubB64)).toBe(AccessRole.Viewer);
	});

	it("the relay carries only ciphertext — no plaintext brief text crosses it", async () => {
		const briefDoc = await link.owner.provisionEntity(BRIEF, NOTE_TYPE);
		const secret = "TOPSECRET-runway-18-months";
		briefDoc.getText("body").insert(0, `${secret} `);

		const frames: Uint8Array[] = [];
		link.collaborator.relay.onFrame((f) => frames.push(f));

		const invite = link.collaborator.invite("Marcus");
		await link.share({ entityId: BRIEF, type: NOTE_TYPE, invite, role: AccessRole.Editor });

		expect(frames.length).toBeGreaterThan(0);
		const secretHex = Buffer.from(secret, "utf8").toString("hex");
		for (const frame of frames) {
			expect(Buffer.from(frame).toString("hex").includes(secretHex)).toBe(false);
		}
		// And Marcus still decrypted it.
		expect(link.collaborator.docs.get(BRIEF)?.getText("body").toString()).toContain(secret);
	});
});
