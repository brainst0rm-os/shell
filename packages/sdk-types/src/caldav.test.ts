import { describe, expect, it } from "vitest";
import {
	type CalDavAccountDef,
	CalDavIssueCode,
	validateCalDavAccount,
	validateCalDavCalendar,
} from "./caldav";

const ACCOUNT: CalDavAccountDef = {
	serverUrl: "https://dav.example.com/",
	principalUrl: "https://dav.example.com/principals/mira/",
	homeUrl: "https://dav.example.com/calendars/mira/",
	username: "mira",
	displayName: "Fastmail",
	egressOrigins: ["https://dav.example.com"],
	enabled: true,
};

describe("validateCalDavAccount", () => {
	it("accepts a complete, secret-free account", () => {
		expect(validateCalDavAccount(ACCOUNT)).toEqual([]);
	});

	it("flags missing fields and non-http URLs", () => {
		const broken = { ...ACCOUNT, username: "", homeUrl: "ftp://dav.example.com/" };
		const codes = validateCalDavAccount(broken).map((i) => i.code);
		expect(codes).toContain(CalDavIssueCode.MissingField);
		expect(codes).toContain(CalDavIssueCode.InvalidUrl);
	});

	it("rejects a wildcard-empty egress list", () => {
		const issues = validateCalDavAccount({ ...ACCOUNT, egressOrigins: [] });
		expect(issues.map((i) => i.code)).toContain(CalDavIssueCode.MissingField);
	});

	it("enforces the custody invariant: a secret-shaped field is an error", () => {
		const leaky = { ...ACCOUNT, password: "hunter2" } as CalDavAccountDef;
		const issues = validateCalDavAccount(leaky);
		expect(issues.map((i) => i.code)).toContain(CalDavIssueCode.SecretOnEntity);
	});
});

describe("validateCalDavCalendar", () => {
	it("accepts a minimal subscription", () => {
		expect(
			validateCalDavCalendar({
				accountRef: "e1",
				url: "https://dav.example.com/calendars/mira/work/",
				displayName: "Work",
				enabled: true,
			}),
		).toEqual([]);
	});

	it("flags a missing accountRef and a bad URL", () => {
		const issues = validateCalDavCalendar({
			accountRef: "",
			url: "nope",
			displayName: "Work",
			enabled: true,
		});
		expect(issues.map((i) => i.code)).toEqual(
			expect.arrayContaining([CalDavIssueCode.MissingField, CalDavIssueCode.InvalidUrl]),
		);
	});
});
