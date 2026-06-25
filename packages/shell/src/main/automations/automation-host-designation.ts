/**
 * 11b.15 — automation-host designation (pure policy core).
 *
 * Exactly ONE device per vault should run the automation scheduler once
 * the vault syncs across devices — double-hosting would double-fire every
 * Time trigger. This module is the policy the session-open registration
 * (the 11b.6 deploy residue) consults before `AutomationsHost.hydrate`/
 * `start`:
 *
 *   - no designation recorded → RUN (the single-device default; a vault
 *     that has never thought about hosting keeps its automations alive);
 *   - designation present → only the matching device runs.
 *
 * Handoff is an explicit user takeover (`takeOverAutomationHost`) — v1
 * ships no liveness probing or automatic failover (that's v2); a designated
 * device that dies simply stops firing until the user re-claims from
 * another device. `deviceId` is the opaque pairing-layer device identity
 * (the Ed25519 public-key fingerprint); this module never interprets it.
 *
 * The designation persists as a small property bag (vault-synced storage —
 * an entity or the per-vault prefs map; the wiring slice decides), so the
 * codec here is defensive: a malformed bag reads as "no designation",
 * which fails OPEN to the single-device default rather than silencing
 * automations vault-wide.
 */

/**
 * Persistence choice (11b.15, resolved): the designation is a **vault-
 * synced entity** — a singleton row of this type at this fixed id, written
 * through the capability-checked entities service under the automations
 * app identity. An entity (rather than the vault-properties Y.Doc) keeps
 * exactly one writer path into each store, syncs to paired devices via the
 * normal entity transport, and lets the app render/claim it through the
 * same `services` surface as everything else.
 */
export const AUTOMATION_HOST_TYPE_URL = "brainstorm/AutomationHostDesignation/v1";
export const AUTOMATION_HOST_ENTITY_ID = "automation-host-designation";

export type AutomationHostDesignation = {
	/** The pairing-layer device identity that owns the scheduler. */
	deviceId: string;
	/** Epoch ms of the claim/takeover — display + tie-break metadata. */
	claimedAt: number;
};

/** Should THIS device run the scheduler? Null designation → yes. */
export function shouldRunScheduler(
	designation: AutomationHostDesignation | null,
	thisDeviceId: string,
): boolean {
	if (designation === null) return true;
	return designation.deviceId === thisDeviceId;
}

/** Claim hosting for this device (first designation or a re-claim). */
export function claimAutomationHost(thisDeviceId: string, now: number): AutomationHostDesignation {
	return { deviceId: thisDeviceId, claimedAt: now };
}

/**
 * Explicit user takeover from another device — the v1 "handoff stub".
 * Identical result to a claim; kept as its own verb so the wiring slice
 * can audit/confirm a takeover differently from a first claim (and so a
 * future v2 failover has a seam to grow from).
 */
export function takeOverAutomationHost(
	_previous: AutomationHostDesignation,
	thisDeviceId: string,
	now: number,
): AutomationHostDesignation {
	return claimAutomationHost(thisDeviceId, now);
}

/** Persistable shape (vault-synced property bag). */
export function designationToProperties(
	designation: AutomationHostDesignation,
): Record<string, unknown> {
	return { deviceId: designation.deviceId, claimedAt: designation.claimedAt };
}

/** Defensive read — anything malformed is "no designation" (fails OPEN to
 *  the single-device default; never silences automations vault-wide). */
export function propertiesToDesignation(raw: unknown): AutomationHostDesignation | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.deviceId !== "string" || obj.deviceId.length === 0) return null;
	if (typeof obj.claimedAt !== "number" || !Number.isFinite(obj.claimedAt)) return null;
	return { deviceId: obj.deviceId, claimedAt: obj.claimedAt };
}
