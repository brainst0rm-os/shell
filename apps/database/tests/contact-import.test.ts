/**
 * Contact import keystone (9.12.16). Proves the vCard 4.0/3.0 + CSV
 * mappers produce Person-catalog drafts, that malformed input degrades
 * (never throws), and the round-trip-relevant fields (FN/N, EMAIL, TEL,
 * ORG, TITLE, BDAY) survive.
 */

import { describe, expect, it } from "vitest";
import {
	ContactImportFormat,
	detectContactFormat,
	importContacts,
	parseBirthday,
	parseContactsCsv,
	parseCsvRows,
	parseVCard,
} from "../src/logic/contact-import";

describe("parseBirthday", () => {
	it("accepts YYYY-MM-DD, YYYYMMDD, and ISO datetime → UTC midnight", () => {
		expect(parseBirthday("1985-04-12")).toBe(Date.UTC(1985, 3, 12));
		expect(parseBirthday("19850412")).toBe(Date.UTC(1985, 3, 12));
		expect(parseBirthday("1985-04-12T09:00:00Z")).toBe(Date.UTC(1985, 3, 12));
	});
	it("drops year-less and unparseable values", () => {
		expect(parseBirthday("--0412")).toBeNull();
		expect(parseBirthday("")).toBeNull();
		expect(parseBirthday("not a date")).toBeNull();
		expect(parseBirthday("1985-13-99")).toBeNull();
	});
});

describe("parseVCard", () => {
	it("maps a 4.0 card's N/FN/EMAIL/TEL/ORG/TITLE/BDAY to the catalog", () => {
		const vcf = [
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Ada Okafor",
			"N:Okafor;Ada;;;",
			"EMAIL;TYPE=work:ada@brainstorm.app",
			"EMAIL;TYPE=home:ada@personal.example",
			"TEL;TYPE=cell:+1 555 0142",
			"ORG:Brainstorm;Platform",
			"TITLE:Founder",
			"BDAY:19850412",
			"END:VCARD",
		].join("\r\n");
		expect(parseVCard(vcf)).toEqual([
			{
				name: "Ada Okafor",
				email: ["ada@brainstorm.app", "ada@personal.example"],
				phone: ["+1 555 0142"],
				company: "Brainstorm",
				role: "Founder",
				birthday: Date.UTC(1985, 3, 12),
			},
		]);
	});

	it("falls back to N when FN is absent, unfolds, and parses multiple cards", () => {
		const vcf = [
			"BEGIN:VCARD",
			"N:Zhao;Lin;;;",
			"EMAIL:lin@x.com",
			"END:VCARD",
			"BEGIN:VCARD",
			"FN:Folded ",
			" Name",
			"END:VCARD",
		].join("\n");
		const out = parseVCard(vcf);
		expect(out[0]).toEqual({ name: "Lin Zhao", email: ["lin@x.com"] });
		expect(out[1]?.name).toBe("Folded Name");
	});

	it("tolerates junk / unknown properties without throwing", () => {
		expect(parseVCard("garbage\nno vcard here")).toEqual([]);
		const vcf = "BEGIN:VCARD\nX-WEIRD:stuff\nFN:Solo\nEND:VCARD";
		expect(parseVCard(vcf)).toEqual([{ name: "Solo" }]);
	});
});

describe("parseCsvRows", () => {
	it('handles quoted fields, embedded commas, and "" escapes', () => {
		const rows = parseCsvRows('a,b\n"x,y","she said ""hi"""\n');
		expect(rows).toEqual([
			["a", "b"],
			["x,y", 'she said "hi"'],
		]);
	});
});

describe("parseContactsCsv", () => {
	it("maps a LinkedIn-shaped export (First/Last/Email/Company/Position)", () => {
		const csv = [
			"First Name,Last Name,Email Address,Company,Position",
			"Mara,Silva,mara@example.com,Acme Press,Launch partner",
		].join("\n");
		expect(parseContactsCsv(csv)).toEqual([
			{
				name: "Mara Silva",
				email: ["mara@example.com"],
				company: "Acme Press",
				role: "Launch partner",
			},
		]);
	});

	it("maps a Google-shaped export (Name + multi-value email) + birthday", () => {
		const csv = [
			"Name,E-mail 1 - Value,Phone 1 - Value,Birthday",
			'Kenji Ito,"kenji@example.com; kenji2@example.com",+1 555 0188,1990-02-03',
		].join("\n");
		expect(parseContactsCsv(csv)).toEqual([
			{
				name: "Kenji Ito",
				email: ["kenji@example.com", "kenji2@example.com"],
				phone: ["+1 555 0188"],
				birthday: Date.UTC(1990, 1, 3),
			},
		]);
	});

	it("skips rows with no derivable name; empty input → []", () => {
		expect(parseContactsCsv("Name,Email\n,nobody@example.com")).toEqual([]);
		expect(parseContactsCsv("")).toEqual([]);
		expect(parseContactsCsv("Name\n")).toEqual([]);
	});
});

describe("dispatch", () => {
	it("detectContactFormat sniffs by extension then content", () => {
		expect(detectContactFormat("a.vcf", "")).toBe(ContactImportFormat.VCard);
		expect(detectContactFormat("a.csv", "")).toBe(ContactImportFormat.Csv);
		expect(detectContactFormat("noext", "BEGIN:VCARD")).toBe(ContactImportFormat.VCard);
		expect(detectContactFormat("noext", "Name,Email")).toBe(ContactImportFormat.Csv);
	});
	it("importContacts routes to the right parser", () => {
		expect(importContacts("BEGIN:VCARD\nFN:X\nEND:VCARD", ContactImportFormat.VCard)).toEqual([
			{ name: "X" },
		]);
		expect(importContacts("Name\nY", ContactImportFormat.Csv)).toEqual([{ name: "Y" }]);
	});
});
