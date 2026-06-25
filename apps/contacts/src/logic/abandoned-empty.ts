/**
 * Abandoned-empty auto-discard for new contacts (F-158, mirrors the Notes
 * F-196 pattern). "New contact" persists immediately so the detail route has a
 * real entity to edit — but a contact the user then abandons without authoring
 * ANYTHING used to pile up as an "Unnamed" ghost row. The decision here is
 * pure (no DOM, no services) so the safety invariant is unit-tested: only a
 * record created THIS session AND still indistinguishable from freshly minted
 * may ever be discarded — never pre-existing rows, never authored content.
 */

import type { Person } from "../types/person";

/** True when a person carries nothing the user authored — no name, email,
 *  phone, company, role, birthday, anniversary, related links or bio (the
 *  avatar is derived from the name, so there's no separate field to check).
 *  Exactly the shape `createPerson` mints. */
export function isAbandonedEmpty(person: Person): boolean {
	return (
		person.name === "" &&
		person.emails.length === 0 &&
		person.phones.length === 0 &&
		person.companyId === null &&
		person.role === "" &&
		person.birthday === null &&
		person.anniversary === null &&
		person.linkIds.length === 0 &&
		person.bio.trim() === ""
	);
}

/** The shared discard decision behind both triggers — navigating away from the
 *  contact and leaving Contacts entirely (app-visibility hide / pagehide). */
export function shouldDiscardAbandoned(
	id: string | null,
	sessionCreated: ReadonlySet<string>,
	persons: readonly Person[],
): id is string {
	if (id === null || !sessionCreated.has(id)) return false;
	const person = persons.find((p) => p.id === id);
	return person !== undefined && isAbandonedEmpty(person);
}

/** True when an entity patch writes any real content — a non-blank string, a
 *  non-empty array, a finite number, or any non-null object (conservative:
 *  unknown shapes count as content). Once a session-created contact receives
 *  an authoring patch it leaves the discardable set FOREVER, so a stale live
 *  snapshot (the patch IPC still in flight when the window hides) can never
 *  make the discard delete what the user just typed. */
export function patchAuthorsContent(patch: Record<string, unknown>): boolean {
	return Object.values(patch).some(valueIsContent);
}

function valueIsContent(value: unknown): boolean {
	if (value == null) return false;
	if (typeof value === "string") return value.trim() !== "";
	if (Array.isArray(value)) return value.some(valueIsContent);
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value === "boolean") return value;
	return true;
}
