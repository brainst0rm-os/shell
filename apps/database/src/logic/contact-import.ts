/**
 * Contact import keystone (9.12.16) — pure text → `Person/v1` draft
 * mapping for vCard (RFC 6350 4.0 + tolerant 3.0) and CSV (Google /
 * Apple / LinkedIn export shapes). No DOM, no file I/O, no entities
 * service: the UI slice (file-open dialog with the `.vcf`/`.csv`
 * extension filters, per-row dedupe merge/skip/create, preview-then-
 * commit through the entities service) is a thin caller layered on top
 * and swapped freely; this module is the long-term contract.
 *
 * Output keys are exactly the Contacts property catalog
 * (`dev/contact-properties.ts`): `name` (display), `email[]`, `phone[]`,
 * `company`, `role`, `birthday` (epoch ms, UTC midnight). Unknown vCard
 * properties / unmapped CSV columns are tolerated and dropped, never
 * fatal — a malformed row yields a best-effort draft, not a throw.
 */

import { parseCsvRows } from "./csv";

export type PersonDraft = {
	name: string;
	email?: string[];
	phone?: string[];
	company?: string;
	role?: string;
	/** Epoch ms at UTC midnight. Omitted when the source has no parseable
	 *  year-bearing date (year-less `--MMDD` is dropped — there is no
	 *  honest epoch for it; recurrence is OQ-CT-3 anyway). */
	birthday?: number;
};

const TYPE = "brainstorm/Person/v1";
export const PERSON_TYPE = TYPE;

/** `YYYY-MM-DD`, `YYYYMMDD`, or an ISO datetime → UTC-midnight epoch ms.
 *  Year-less (`--MMDD`) or unparseable → null. */
export function parseBirthday(raw: string): number | null {
	const v = raw.trim();
	if (!v || v.startsWith("--")) return null;
	const m = v.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
	if (!m) return null;
	const [, y, mo, d] = m;
	const year = Number(y);
	const month = Number(mo);
	const day = Number(d);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const ms = Date.UTC(year, month - 1, day);
	return Number.isNaN(ms) ? null : ms;
}

// ─── vCard ───────────────────────────────────────────────────────────────────

/** Unfold per RFC 6350 §3.2: a line beginning with space/tab is a
 *  continuation of the previous one. */
function unfold(text: string): string[] {
	const raw = text.split(/\r\n|\r|\n/);
	const out: string[] = [];
	for (const line of raw) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

/** Split `NAME;PARAM=x:value:with:colons` into name, params, value. The
 *  value is everything after the FIRST unescaped colon. */
function parseLine(line: string): { name: string; params: string[]; value: string } | null {
	const colon = line.indexOf(":");
	if (colon === -1) return null;
	const head = line.slice(0, colon);
	const value = line.slice(colon + 1);
	const [name, ...params] = head.split(";");
	if (!name) return null;
	return { name: name.toUpperCase(), params, value };
}

/** Unescape RFC 6350 text-value escapes (`\n \, \; \\`). */
function unescapeValue(v: string): string {
	return v.replace(/\\([nN,;\\])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

function nameFromN(value: string): string {
	// N = Family;Given;Additional;Prefix;Suffix
	const [family = "", given = "", additional = ""] = value.split(";").map((s) => s.trim());
	return [given, additional, family].filter(Boolean).join(" ").trim();
}

export function parseVCard(text: string): PersonDraft[] {
	const drafts: PersonDraft[] = [];
	let cur: (PersonDraft & { _fn?: string; _n?: string }) | null = null;

	for (const line of unfold(text)) {
		const parsed = parseLine(line);
		if (!parsed) continue;
		const { name, value } = parsed;

		if (name === "BEGIN" && value.trim().toUpperCase() === "VCARD") {
			cur = { name: "" };
			continue;
		}
		if (name === "END" && value.trim().toUpperCase() === "VCARD") {
			if (cur) {
				const display = (cur._fn || (cur._n ? nameFromN(cur._n) : "") || "").trim();
				if (display || cur.email || cur.phone) {
					const { _fn, _n, ...draft } = cur;
					drafts.push({ ...draft, name: display || "(no name)" });
				}
			}
			cur = null;
			continue;
		}
		if (!cur) continue;

		const val = unescapeValue(value).trim();
		if (!val) continue;
		switch (name) {
			case "FN":
				cur._fn = val;
				break;
			case "N":
				cur._n = value;
				break;
			case "EMAIL": {
				cur.email ??= [];
				cur.email.push(val);
				break;
			}
			case "TEL": {
				cur.phone ??= [];
				cur.phone.push(val);
				break;
			}
			case "ORG":
				// ORG = Org;Unit1;Unit2 — the first component is the company.
				cur.company = value.split(";")[0]?.trim() || val;
				break;
			case "TITLE":
				cur.role = val;
				break;
			case "BDAY": {
				const ms = parseBirthday(val);
				if (ms !== null) cur.birthday = ms;
				break;
			}
		}
	}
	return drafts;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** Re-exported from the shared `./csv` module (one tokenizer, two callers —
 *  the generic 9.12.19 column inference is the second). Kept exported here so
 *  this module's existing import sites don't churn. */
export { parseCsvRows };

function pick(header: string[], ...needles: string[]): number {
	for (let i = 0; i < header.length; i++) {
		const h = header[i]?.toLowerCase().trim() ?? "";
		if (needles.some((n) => h === n || h.includes(n))) return i;
	}
	return -1;
}

/** Exact-header match only. The full-name column MUST NOT use substring
 *  matching — `includes("name")` would wrongly claim "First Name" /
 *  "Last Name" (LinkedIn) and lose the surname. */
function pickExact(header: string[], ...names: string[]): number {
	for (let i = 0; i < header.length; i++) {
		const h = header[i]?.toLowerCase().trim() ?? "";
		if (names.includes(h)) return i;
	}
	return -1;
}

/** Column-mapped CSV → drafts. Handles Google Contacts
 *  (`Name`/`Given Name`/`E-mail 1 - Value`…), Apple, and LinkedIn
 *  (`First Name`/`Last Name`/`Email Address`/`Company`/`Position`). */
export function parseContactsCsv(text: string): PersonDraft[] {
	const rows = parseCsvRows(text);
	const header = rows[0];
	if (!header || rows.length < 2) return [];

	const cName = pickExact(header, "name", "full name", "display name");
	const cFirst = pick(header, "first name", "given name");
	const cLast = pick(header, "last name", "family name", "surname");
	const cEmail = pick(header, "email", "e-mail");
	const cPhone = pick(header, "phone", "mobile", "tel");
	const cCompany = pick(header, "company", "organization", "organisation");
	const cRole = pick(header, "title", "position", "role", "job");
	const cBday = pick(header, "birthday", "bday", "date of birth");

	const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
	const drafts: PersonDraft[] = [];
	for (let i = 1; i < rows.length; i++) {
		const r = rows[i];
		if (!r) continue;
		const composed = [at(r, cFirst), at(r, cLast)].filter(Boolean).join(" ").trim();
		const name = at(r, cName) || composed;
		if (!name) continue;
		const draft: PersonDraft = { name };
		const email = at(r, cEmail);
		if (email)
			draft.email = email
				.split(/[;,]/)
				.map((s) => s.trim())
				.filter(Boolean);
		const phone = at(r, cPhone);
		if (phone)
			draft.phone = phone
				.split(/[;,]/)
				.map((s) => s.trim())
				.filter(Boolean);
		const company = at(r, cCompany);
		if (company) draft.company = company;
		const role = at(r, cRole);
		if (role) draft.role = role;
		const bday = parseBirthday(at(r, cBday));
		if (bday !== null) draft.birthday = bday;
		drafts.push(draft);
	}
	return drafts;
}

export enum ContactImportFormat {
	VCard = "vcard",
	Csv = "csv",
}

/** Format dispatch by extension/sniff — the thin file caller passes the
 *  filename; content sniff falls back when the extension lies. */
export function importContacts(text: string, format: ContactImportFormat): PersonDraft[] {
	return format === ContactImportFormat.VCard ? parseVCard(text) : parseContactsCsv(text);
}

export function detectContactFormat(filename: string, text: string): ContactImportFormat {
	if (/\.vcf$/i.test(filename)) return ContactImportFormat.VCard;
	if (/\.csv$/i.test(filename)) return ContactImportFormat.Csv;
	return /BEGIN:VCARD/i.test(text) ? ContactImportFormat.VCard : ContactImportFormat.Csv;
}
