/**
 * Standalone-preview dataset. When the app runs outside the shell (no vault
 * services) it operates on this in-memory set so the surface is explorable —
 * mirrors the demo fallbacks in the other first-party apps. Birthdays are
 * anchored relative to today so the "Upcoming birthdays" strip demonstrates.
 */

import { COMPANY_TYPE, PERSON_TYPE, type VaultEntityLike } from "../types/person";

function birthdayDaysFromNow(days: number, age: number): number {
	const d = new Date();
	d.setFullYear(d.getFullYear() - age);
	d.setDate(d.getDate() + days);
	d.setHours(9, 0, 0, 0);
	return d.getTime();
}

export function demoEntities(): VaultEntityLike[] {
	return [
		{ id: "demo_company_acme", type: COMPANY_TYPE, properties: { name: "Acme Corp" } },
		{
			id: "demo_person_ada",
			type: PERSON_TYPE,
			properties: {
				name: "Ada Okafor",
				email: ["ada@acme.example"],
				phone: ["+1 555 0142"],
				company: "demo_company_acme",
				role: "Founder",
				birthday: birthdayDaysFromNow(3, 34),
				links: ["demo_person_lin"],
				bio: "Met at the 2024 design summit.",
			},
		},
		{
			id: "demo_person_lin",
			type: PERSON_TYPE,
			properties: {
				name: "Lin Zhao",
				email: ["lin@acme.example"],
				company: "demo_company_acme",
				role: "Engineer",
				links: ["demo_person_ada"],
			},
		},
		{
			id: "demo_person_mara",
			type: PERSON_TYPE,
			properties: {
				name: "Mara Silva",
				email: ["mara@studio.example"],
				phone: ["+44 20 7946 0958"],
				role: "Designer",
				birthday: birthdayDaysFromNow(120, 29),
			},
		},
		{
			id: "demo_person_kenji",
			type: PERSON_TYPE,
			properties: { name: "Kenji Ito", role: "Advisor" },
		},
	];
}
