import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSON_TYPE } from "./contact-import";
import { ImportAction } from "./contact-import-plan";
import {
	type ExistingEntity,
	type TypeImportMapper,
	_resetImportRegistryForTests,
	contactsImportMapper,
	importMapperForExtension,
	importMapperForType,
	registerBuiltInImportMappers,
	registerImportMapper,
	registeredImportTypeUrls,
	runImport,
} from "./import-registry";

beforeEach(() => {
	_resetImportRegistryForTests();
	registerBuiltInImportMappers();
});
afterEach(() => _resetImportRegistryForTests());

const VCARD = "BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEMAIL:ada@x.test\nEND:VCARD\n";
const CSV = "Name,Email\nGrace Hopper,grace@x.test\n";

describe("registry lookup", () => {
	it("registers the built-in Contacts mapper for Person/v1 + .vcf/.csv", () => {
		expect(registeredImportTypeUrls()).toEqual([PERSON_TYPE]);
		expect(importMapperForType(PERSON_TYPE)).toBe(contactsImportMapper);
		expect(importMapperForExtension("vcf")).toBe(contactsImportMapper);
		expect(importMapperForExtension(".CSV")).toBe(contactsImportMapper); // dot + case tolerant
		expect(importMapperForExtension("txt")).toBeNull();
		expect(importMapperForType("io.brainstorm.unknown/Type/v1")).toBeNull();
	});

	it("registering the same mapper twice is idempotent", () => {
		expect(() => registerBuiltInImportMappers()).not.toThrow();
		expect(registeredImportTypeUrls()).toEqual([PERSON_TYPE]);
	});

	it("a different mapper for an already-claimed type throws (rebind guard)", () => {
		const shadow = { ...contactsImportMapper } as TypeImportMapper;
		expect(() => registerImportMapper(shadow)).toThrow(/already has a different mapper/);
	});
});

describe("runImport — Contacts via the generic pipeline", () => {
	const NONE: ReadonlyArray<ExistingEntity> = [];

	it("detects + parses vCard and plans every row Create when nothing exists", () => {
		const run = runImport(contactsImportMapper, "people.vcf", VCARD, NONE);
		expect(run.format).toBe("vcard");
		expect(run.drafts).toHaveLength(1);
		expect(run.plan[0]?.action).toBe(ImportAction.Create);
		expect(run.commands).toEqual([
			{ op: "create", properties: expect.objectContaining({ name: "Ada Lovelace" }) },
		]);
		expect(run.summary).toEqual({ create: 1, merge: 0, skip: 0 });
	});

	it("detects + parses CSV and merges against an existing email match", () => {
		const existing: ExistingEntity[] = [
			{ id: "p1", properties: { name: "Grace Hopper", email: ["grace@x.test"] } },
		];
		const run = runImport(contactsImportMapper, "export.csv", CSV, existing);
		expect(run.format).toBe("csv");
		expect(run.plan[0]?.action).toBe(ImportAction.Merge);
		expect(run.plan[0]?.matchId).toBe("p1");
		expect(run.commands).toEqual([{ op: "update", id: "p1", properties: expect.any(Object) }]);
		expect(run.summary).toEqual({ create: 0, merge: 1, skip: 0 });
	});

	it("content sniff drives the format when the extension is ambiguous", () => {
		// `.txt` isn't claimed, but a caller may still hand the mapper raw
		// content — a vCard body sniffs to vCard regardless of filename.
		expect(contactsImportMapper.detectFormat("clip.txt", VCARD)).toBe("vcard");
		expect(contactsImportMapper.detectFormat("clip.txt", CSV)).toBe("csv");
	});

	it("a per-row Skip override emits no command for that row", () => {
		const run = runImport(contactsImportMapper, "people.vcf", VCARD, NONE);
		const overridden = contactsImportMapper.commandsFor(run.plan, { 0: ImportAction.Skip });
		expect(overridden).toEqual([]);
		expect(contactsImportMapper.summarize(run.plan, { 0: ImportAction.Skip })).toEqual({
			create: 0,
			merge: 0,
			skip: 1,
		});
	});
});
