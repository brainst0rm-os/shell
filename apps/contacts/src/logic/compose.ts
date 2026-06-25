/**
 * Pure logic behind the "New contact" compose popover. The popover collects a
 * draft; this maps it onto the `Person/v1` property bag plus the company name
 * the caller resolves to an existing `Company/v1` (case-insensitive) or mints.
 * The entity is created ONLY on submit — cancelling the popover never leaves
 * an "Unnamed" ghost row, so there is nothing to auto-discard.
 */

import { COMPANY_TYPE, type VaultEntityLike } from "../types/person";

export type ComposeDraft = {
	name: string;
	company: string;
	email: string;
	phone: string;
};

export function emptyComposeDraft(): ComposeDraft {
	return { name: "", company: "", email: "", phone: "" };
}

/** A draft is creatable once it carries a non-blank name. */
export function composeDraftValid(draft: ComposeDraft): boolean {
	return draft.name.trim() !== "";
}

export type ComposePlan = {
	/** `Person/v1` properties — sans `company`, which the caller links by id. */
	props: Record<string, unknown>;
	/** Company display name to resolve or mint, or `null` for none. */
	companyName: string | null;
};

/** Map a compose draft to a creation plan; `null` when the draft is invalid
 *  (blank name). Blank optional fields are omitted from the property bag so a
 *  fresh contact carries only what the user actually entered. */
export function planCompose(draft: ComposeDraft): ComposePlan | null {
	const name = draft.name.trim();
	if (!name) return null;
	const props: Record<string, unknown> = { name };
	const email = draft.email.trim();
	if (email) props.email = [email];
	const phone = draft.phone.trim();
	if (phone) props.phone = [phone];
	const companyName = draft.company.trim();
	return { props, companyName: companyName || null };
}

/** `lower-cased name → id` index over the Company rows of a snapshot — the
 *  case-insensitive resolve both compose and vCard import link through, so
 *  typing an existing company's name links it instead of duplicating it. */
export function buildCompanyNameIndex(entities: readonly VaultEntityLike[]): Map<string, string> {
	const index = new Map<string, string>();
	for (const entity of entities) {
		if (entity.type !== COMPANY_TYPE) continue;
		const raw = entity.properties.name;
		const name = typeof raw === "string" ? raw.trim() : "";
		const key = name.toLocaleLowerCase();
		if (name && !index.has(key)) index.set(key, entity.id);
	}
	return index;
}
