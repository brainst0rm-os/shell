/**
 * Pure vCard 3.0 / 4.0 codec (9.23.4). Serializes contacts to vCard 3.0 — the
 * broadest-compatibility flavour (Apple Contacts / Google / Outlook all
 * round-trip it) — and parses both 3.0 and 4.0 input tolerantly. No DOM, no
 * services: the Files-host wiring lives in `ui/vcard-actions`. Maps the subset
 * of vCard a `Person/v1` carries: FN/N, EMAIL, TEL, ORG (company name), TITLE
 * (role), BDAY, ANNIVERSARY, NOTE (bio). Unit-tested in isolation.
 */

import type { Person } from "../types/person";

/** The intermediate contact shape the codec produces / consumes. `org` is the
 *  company *name* (vCard has no entity refs); the import orchestrator resolves
 *  it to a `Company/v1` entity, and export fills it from the resolved name. */
export type VCardContact = {
	name: string;
	emails: string[];
	phones: string[];
	org: string | null;
	role: string | null;
	birthday: number | null;
	anniversary: number | null;
	note: string | null;
};

/** Project a `Person` view-model + its resolved company name into a contact
 *  the codec can serialize. Empty scalar fields collapse to `null` so the
 *  exporter omits the corresponding vCard line. */
export function personToVCard(person: Person, companyName: string | null): VCardContact {
	return {
		name: person.name,
		emails: person.emails,
		phones: person.phones,
		org: companyName?.trim() || null,
		role: person.role.trim() || null,
		birthday: person.birthday,
		anniversary: person.anniversary,
		note: person.bio.trim() || null,
	};
}

const CRLF = "\r\n";
/** RFC 6350 §3.2 soft line-length limit (octets). We fold conservatively on
 *  character count, which is correct for ASCII and safe (shorter) for UTF-8. */
const FOLD_AT = 73;

function escapeValue(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\r?\n/g, "\\n")
		.replace(/,/g, "\\,")
		.replace(/;/g, "\\;");
}

function unescapeValue(value: string): string {
	let out = "";
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch === "\\" && i + 1 < value.length) {
			const next = value[++i];
			out += next === "n" || next === "N" ? "\n" : (next ?? "");
		} else {
			out += ch;
		}
	}
	return out;
}

function formatDate(ms: number): string {
	const d = new Date(ms);
	const y = d.getFullYear().toString().padStart(4, "0");
	const m = (d.getMonth() + 1).toString().padStart(2, "0");
	const day = d.getDate().toString().padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/** Parse a vCard date value (`YYYY-MM-DD`, `YYYYMMDD`, optionally with a time
 *  suffix). Anchors at local noon so a time-zone offset never shifts the
 *  stored day. Returns `null` for a year-less (`--MMDD`) or unparseable value. */
export function parseVCardDate(raw: string): number | null {
	const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(raw.trim());
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

/** vCard `N` is `Family;Given;Additional;Prefix;Suffix`. Derive a plausible
 *  structured name from a display name (last word = family, rest = given). */
function structuredName(displayName: string): string {
	const words = displayName.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return ";;;;";
	if (words.length === 1) return `;${escapeValue(words[0] ?? "")};;;`;
	const family = words[words.length - 1] ?? "";
	const given = words.slice(0, -1).join(" ");
	return `${escapeValue(family)};${escapeValue(given)};;;`;
}

/** Fold a single logical line to the soft length limit (continuation lines are
 *  prefixed with a single space per RFC 6350 §3.2). */
function foldLine(line: string): string {
	if (line.length <= FOLD_AT) return line;
	const parts: string[] = [line.slice(0, FOLD_AT)];
	let rest = line.slice(FOLD_AT);
	while (rest.length > FOLD_AT - 1) {
		parts.push(` ${rest.slice(0, FOLD_AT - 1)}`);
		rest = rest.slice(FOLD_AT - 1);
	}
	if (rest.length > 0) parts.push(` ${rest}`);
	return parts.join(CRLF);
}

/** Serialize one contact to a vCard 3.0 record (CRLF-terminated). */
export function serializeVCard(contact: VCardContact): string {
	const displayName = contact.name.trim() || "Unnamed";
	const lines: string[] = [
		"BEGIN:VCARD",
		"VERSION:3.0",
		`FN:${escapeValue(displayName)}`,
		`N:${structuredName(displayName)}`,
	];
	for (const email of contact.emails) lines.push(`EMAIL:${escapeValue(email)}`);
	for (const phone of contact.phones) lines.push(`TEL:${escapeValue(phone)}`);
	if (contact.org) lines.push(`ORG:${escapeValue(contact.org)}`);
	if (contact.role) lines.push(`TITLE:${escapeValue(contact.role)}`);
	if (contact.birthday !== null) lines.push(`BDAY:${formatDate(contact.birthday)}`);
	if (contact.anniversary !== null) lines.push(`ANNIVERSARY:${formatDate(contact.anniversary)}`);
	if (contact.note) lines.push(`NOTE:${escapeValue(contact.note)}`);
	lines.push("END:VCARD");
	return `${lines.map(foldLine).join(CRLF)}${CRLF}`;
}

/** Serialize a list of contacts into one multi-card vCard document. */
export function serializeVCards(contacts: readonly VCardContact[]): string {
	return contacts.map(serializeVCard).join("");
}

/** Unfold a raw vCard document into logical lines: RFC 6350 continuation lines
 *  (starting with a space or tab) are joined to the preceding line. */
function unfoldLines(text: string): string[] {
	const physical = text.split(/\r\n|\r|\n/);
	const logical: string[] = [];
	for (const line of physical) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length > 0) {
			logical[logical.length - 1] += line.slice(1);
		} else {
			logical.push(line);
		}
	}
	return logical;
}

type ParsedLine = { name: string; raw: string };

/** Split a property line into its (upper-cased) name and raw value, dropping
 *  the parameter section (`;TYPE=...`). Returns `null` for a line with no `:`. */
function parseLine(line: string): ParsedLine | null {
	const colon = line.indexOf(":");
	if (colon < 0) return null;
	const head = line.slice(0, colon);
	const raw = line.slice(colon + 1);
	const semi = head.indexOf(";");
	const name = (semi < 0 ? head : head.slice(0, semi)).trim().toUpperCase();
	return { name, raw };
}

/** First component of a structured value (split on unescaped `;`). */
function firstComponent(raw: string): string {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (ch === "\\" && i + 1 < raw.length) {
			out += ch + raw[++i];
		} else if (ch === ";") {
			break;
		} else {
			out += ch;
		}
	}
	return out;
}

function emptyContact(): VCardContact {
	return {
		name: "",
		emails: [],
		phones: [],
		org: null,
		role: null,
		birthday: null,
		anniversary: null,
		note: null,
	};
}

/** Parse a vCard document (one or more cards) into contacts. Tolerant of 3.0
 *  and 4.0; unknown properties are ignored. A card with no usable identity
 *  (no name, no email, no phone) is dropped. */
export function parseVCards(text: string): VCardContact[] {
	const contacts: VCardContact[] = [];
	let current: VCardContact | null = null;
	let fnName = "";
	let nName = "";
	for (const line of unfoldLines(text)) {
		const trimmed = line.trim();
		if (trimmed.toUpperCase() === "BEGIN:VCARD") {
			current = emptyContact();
			fnName = "";
			nName = "";
			continue;
		}
		if (trimmed.toUpperCase() === "END:VCARD") {
			if (current) {
				current.name = (fnName || nName).trim();
				if (current.name || current.emails.length > 0 || current.phones.length > 0) {
					contacts.push(current);
				}
			}
			current = null;
			continue;
		}
		if (!current) continue;
		const parsed = parseLine(line);
		if (!parsed) continue;
		switch (parsed.name) {
			case "FN":
				fnName = unescapeValue(parsed.raw);
				break;
			case "N": {
				// `Family;Given;...` → "Given Family" when no FN is present.
				const [family = "", given = ""] = parsed.raw.split(/(?<!\\);/);
				nName = `${unescapeValue(given)} ${unescapeValue(family)}`.trim();
				break;
			}
			case "EMAIL": {
				const value = unescapeValue(parsed.raw).trim();
				if (value) current.emails.push(value);
				break;
			}
			case "TEL": {
				const value = unescapeValue(parsed.raw).trim();
				if (value) current.phones.push(value);
				break;
			}
			case "ORG": {
				const value = unescapeValue(firstComponent(parsed.raw)).trim();
				if (value) current.org = value;
				break;
			}
			case "TITLE": {
				const value = unescapeValue(parsed.raw).trim();
				if (value) current.role = value;
				break;
			}
			case "BDAY":
				current.birthday = parseVCardDate(parsed.raw);
				break;
			case "ANNIVERSARY":
				current.anniversary = parseVCardDate(parsed.raw);
				break;
			case "NOTE": {
				const value = unescapeValue(parsed.raw);
				if (value.trim()) current.note = value;
				break;
			}
		}
	}
	return contacts;
}
