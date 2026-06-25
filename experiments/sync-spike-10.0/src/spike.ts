// Entrypoint: runs the documented edit sequence + prints the proof transcript.
// This is the "supporting" deliverable per the iteration 10.0 spec — the real
// deliverable is docs/_review/2026-05-20-10.0-sync-spike.md.

import type * as Y from "yjs";

import { Client } from "./client.ts";
import { BlindRelay } from "./relay.ts";

function banner(s: string): void {
	console.log(`\n${"═".repeat(72)}`);
	console.log(s);
	console.log("═".repeat(72));
}

function line(s: string): void {
	console.log(s);
}

function must<T>(value: T | null | undefined, what: string): T {
	if (value === null || value === undefined) throw new Error(`FAIL: ${what} missing`);
	return value;
}

async function main(): Promise<void> {
	banner("sync-spike-10.0 — proof transcript");
	line(
		"Two devices (Alice, Bob) sharing one sovereign user identity, syncing one entity Y.Doc through a blind in-process relay. Run via `bun run src/spike.ts`.",
	);

	const relay = new BlindRelay();

	// --- Provision Alice (first device, generates sovereign user identity) ---
	const alice = new Client({ deviceLabel: "alice" });
	// --- Provision Bob (second device, receives Alice's user identity via QR/code) ---
	const bob = new Client({ deviceLabel: "bob", userEd25519: alice.userEd25519 });

	alice.connect(relay);
	bob.connect(relay);

	const entityId = "ent_synspike";

	banner("Step 1 — Alice creates the entity and types two characters");
	const aliceState = alice.createEntity(entityId);
	// Subscribe AFTER creating so the relay knows where to fan-out.
	alice.subscribe(entityId);
	const aliceTitle = (aliceState.doc.getMap("root").get("properties") as Y.Map<unknown>).get(
		"title",
	) as Y.Text;
	alice.editEntity(entityId, () => {
		aliceTitle.insert(0, "Hi");
	});
	line(`alice title after step 1: "${alice.titleOf(entityId)}"`);

	banner("Step 2 — Pairing: Alice attaches Bob's wraps + add-device record");
	alice.appendAddDevice(aliceState, bob.deviceEd25519.pub, bob.deviceX25519.pub);
	alice.attachWrap(aliceState, bob.deviceX25519.pub);
	// The add-device record is now part of the Yjs doc; Bob will see it
	// when the snapshot lands. The wrap-for-Bob blob is also inside the doc,
	// BUT Bob can't read the doc without the DEK — so Alice first sends a
	// separate `wrap` envelope addressed to Bob's X25519 pubkey containing
	// ONLY the wrap, not the doc.
	bob.subscribe(entityId);
	const wrapSend = alice.sendWrapTo(entityId, {
		devicePub: bob.deviceEd25519.pub,
		deviceX25519Pub: bob.deviceX25519.pub,
		label: bob.deviceLabel,
	});
	line(`alice → bob wrap envelope: ${wrapSend.envelopeBytes} bytes`);
	// Bob has to drain his inbox to see the wrap envelope. He bootstraps from it.
	// The pump() default would try to apply it as a Yjs update; we route the
	// wrap envelope through a dedicated bootstrap step.
	const bootstrapFrame = drainOne(bob);
	bob.bootstrapEntityFromWrap(entityId, bootstrapFrame);
	line("bob unwrapped DEK and bootstrapped local entity shell");

	// Alice now sends a snapshot. Bob's entity already exists locally so pump()
	// will accept it.
	const snapshotSend = alice.sendSnapshot(entityId);
	line(`alice → bob snapshot envelope: ${snapshotSend.envelopeBytes} bytes`);
	const drainedSnap = bob.pump();
	line(`bob drained ${drainedSnap} envelope from relay (snapshot)`);
	line(`bob title after snapshot: "${bob.titleOf(entityId)}"`);
	if (bob.titleOf(entityId) !== "Hi") throw new Error("FAIL: bob did not converge on snapshot");

	banner("Step 3 — Concurrent edits (each appends one char in its own txn)");
	const bobState = must(bob.entity(entityId), "bob entity state");
	const bobTitle = (bobState.doc.getMap("root").get("properties") as Y.Map<unknown>).get(
		"title",
	) as Y.Text;
	// Both edits happen before either side pumps — true concurrent edit.
	const aliceEdit = alice.editEntity(entityId, () => {
		aliceTitle.insert(2, "!"); // "Hi" -> "Hi!"
	});
	const bobEdit = bob.editEntity(entityId, () => {
		bobTitle.insert(2, "?"); // "Hi" -> "Hi?"
	});
	line(
		`alice edit envelope: ${aliceEdit.envelopeBytes} bytes (plaintext yjs-update bytes: ${aliceEdit.plaintextUpdateBytes})`,
	);
	line(
		`bob   edit envelope: ${bobEdit.envelopeBytes} bytes (plaintext yjs-update bytes: ${bobEdit.plaintextUpdateBytes})`,
	);
	// Both clients pump to drain each other's update.
	alice.pump();
	bob.pump();
	const aliceFinal = alice.titleOf(entityId);
	const bobFinal = bob.titleOf(entityId);
	line(`alice final title: "${aliceFinal}"`);
	line(`bob   final title: "${bobFinal}"`);
	if (aliceFinal !== bobFinal) throw new Error("FAIL: clients did not converge");
	if (aliceFinal !== "Hi!?" && aliceFinal !== "Hi?!") {
		throw new Error(`FAIL: unexpected convergent title "${aliceFinal}"`);
	}
	line("CRDT convergence: OK");

	banner("Step 4 — Verify add-device records under the sovereign user pubkey");
	const aliceVerifies = alice.verifyAddDeviceRecords(entityId, alice.userEd25519.pub);
	const bobVerifies = bob.verifyAddDeviceRecords(entityId, alice.userEd25519.pub);
	line(`alice verifyAddDevice: ${aliceVerifies}`);
	line(`bob   verifyAddDevice: ${bobVerifies}`);
	if (!aliceVerifies || !bobVerifies) throw new Error("FAIL: add-device records did not verify");

	banner("Step 5 — The relay's view (proof: ciphertext + routing only)");
	const log = relay.snapshotLog();
	line(`relay observed ${log.length} forwarded envelopes (excluding sender-echo suppression)`);
	for (const entry of log) {
		console.log(
			`  #${String(entry.seq).padStart(2, "0")} ${entry.fromLabel.padEnd(5)} → ${entry.toLabel.padEnd(
				5,
			)} ${String(entry.bytes).padStart(4)}B  header=${entry.headerSummary}`,
		);
		console.log(`        first 48 bytes: ${entry.hexPrefix}`);
	}

	banner("Step 6 — Side-channel summary (what a malicious relay learns)");
	const summary = sideChannelSummary(log);
	for (const lineStr of summary) console.log(`  • ${lineStr}`);

	banner("Step 7 — Structural-blindness assertion");
	// We can't import this assert from `relay.ts` because that would be circular,
	// and we don't want to inspect node_modules paths. Read the file ourselves.
	// (This is a fail-loud check, not a real CI gate. The CI gate is rule
	// documented in `experiments/sync-spike-10.0/README.md` and in the proof
	// doc; the production-side analogue lives in the future shell sync code.)
	const relaySrc = await import("node:fs/promises").then((fs) =>
		fs.readFile(new URL("./relay.ts", import.meta.url), "utf8"),
	);
	// Match only real `from "@noble/..."` or `from "./crypto..."` IMPORTS, not
	// comment text that mentions them.
	const importRe = /^\s*import\b[^;]*from\s+["'](?:@noble\/|\.\/crypto)/m;
	if (importRe.test(relaySrc)) {
		throw new Error("FAIL: relay.ts has a crypto import — blind-relay invariant violated");
	}
	line(
		"relay.ts has zero imports from @noble/* or ./crypto.ts — the blind-relay property is structural, not promised.",
	);

	console.log("\n[spike] done.\n");
}

function drainOne(client: Client): Uint8Array {
	// Reach into the client to pull one frame without applying it. Spike-only.
	const c = client as unknown as { incomingBuffer: Uint8Array[] };
	const frame = c.incomingBuffer.shift();
	if (!frame) throw new Error("expected at least one frame for bootstrap");
	return frame;
}

function sideChannelSummary(
	log: ReadonlyArray<{ headerSummary: string; bytes: number }>,
): string[] {
	const out: string[] = [];
	// Entity-id frequency
	const perEntity = new Map<string, number>();
	// Kind distribution
	const perKind = new Map<string, number>();
	// Sender → frame count
	const perSender = new Map<string, number>();
	// Sizes
	const sizes: number[] = [];
	for (const entry of log) {
		const header = JSON.parse(entry.headerSummary) as {
			entityId: string;
			kind: string;
			sender: string;
		};
		perEntity.set(header.entityId, (perEntity.get(header.entityId) ?? 0) + 1);
		perKind.set(header.kind, (perKind.get(header.kind) ?? 0) + 1);
		perSender.set(header.sender, (perSender.get(header.sender) ?? 0) + 1);
		sizes.push(entry.bytes);
	}
	out.push(`entity-id distribution: ${JSON.stringify(Array.from(perEntity.entries()))}`);
	out.push(`kind distribution: ${JSON.stringify(Array.from(perKind.entries()))}`);
	out.push(`sender distribution: ${JSON.stringify(Array.from(perSender.entries()))}`);
	out.push(`envelope sizes (bytes): [${sizes.join(", ")}] — leaks edit magnitude`);
	out.push(
		"timing: a relay sees the wall-clock interval between envelopes (cursor activity, keystroke cadence)",
	);
	out.push("subscribe set: a relay knows which device labels subscribed to which entity ids");
	out.push(
		"what a relay does NOT see: title text, doc structure, member-set inside the doc, body content, awareness state",
	);
	return out;
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
