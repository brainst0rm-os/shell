import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERSON_TYPE } from "./contact-import";
import { ImportAction, type ImportPlanRow } from "./contact-import-plan";
import {
	type ImportFileService,
	PickAndParseKind,
	activeImportMappers,
	pickAndParseImport,
} from "./import-orchestrator";
import {
	type ExistingEntity,
	type ImportRun,
	type TypeImportMapper,
	_resetImportRegistryForTests,
	contactsImportMapper,
	registerBuiltInImportMappers,
} from "./import-registry";

const HANDLE = { handleId: "h_test", displayName: "contacts.vcf" };

function makeService(overrides?: Partial<ImportFileService>): ImportFileService {
	return {
		requestOpen: vi.fn(async () => [HANDLE]),
		read: vi.fn(async () =>
			new TextEncoder().encode(
				"BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ada Lovelace\r\nEMAIL:ada@example.com\r\nEND:VCARD\r\n",
			),
		),
		...overrides,
	};
}

const TWO_PERSON_VCARD = [
	"BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Ada Lovelace\r\nEMAIL:ada@example.com\r\nEND:VCARD\r\n",
	"BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Grace Hopper\r\nEMAIL:grace@example.com\r\nEND:VCARD\r\n",
].join("");

describe("pickAndParseImport", () => {
	const MAPPERS: readonly TypeImportMapper[] = [contactsImportMapper as TypeImportMapper];

	it("Ready disposition when the file parses + plans cleanly", async () => {
		const files = makeService({
			read: vi.fn(async () => new TextEncoder().encode(TWO_PERSON_VCARD)),
		});
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.Ready);
		if (result.kind !== PickAndParseKind.Ready) return;
		expect(result.filename).toBe("contacts.vcf");
		expect(result.run.drafts.length).toBe(2);
		expect(result.run.summary).toEqual({ create: 2, merge: 0, skip: 0 });
		// The mapper's commandsFor + summarize ran — the run is committable
		// straight off result.run.commands without further setup.
		expect(result.run.commands.length).toBeGreaterThanOrEqual(2);
	});

	it("Cancelled when the picker returns []", async () => {
		const files = makeService({ requestOpen: vi.fn(async () => []) });
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.Cancelled);
		expect(files.read).not.toHaveBeenCalled();
	});

	it("NoMapper when the filename's extension matches no registered mapper", async () => {
		const files = makeService({
			requestOpen: vi.fn(async () => [{ handleId: "h", displayName: "ignored.xml" }]),
		});
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.NoMapper);
		if (result.kind !== PickAndParseKind.NoMapper) return;
		expect(result.filename).toBe("ignored.xml");
		expect(result.extension).toBe("xml");
		// Failing fast — read never called when the extension has no mapper.
		expect(files.read).not.toHaveBeenCalled();
	});

	it("NoMapper when the filename has no extension at all", async () => {
		// A picker can return a handle whose displayName lacks an extension
		// (the user typed "contacts" without ".vcf"). We surface NoMapper
		// rather than guessing — explicit beats clever when we're about to
		// write rows into the user's vault.
		const files = makeService({
			requestOpen: vi.fn(async () => [{ handleId: "h", displayName: "no-extension" }]),
		});
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.NoMapper);
		if (result.kind !== PickAndParseKind.NoMapper) return;
		expect(result.extension).toBe("");
	});

	it("NoMapper for a dotfile (leading dot is hidden-filename convention, not an extension)", async () => {
		const files = makeService({
			requestOpen: vi.fn(async () => [{ handleId: "h", displayName: ".vcf-backup" }]),
		});
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.NoMapper);
	});

	it("NoMapper for a filename ending in a bare dot (trailing-dot edge)", async () => {
		const files = makeService({
			requestOpen: vi.fn(async () => [{ handleId: "h", displayName: "contacts." }]),
		});
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.NoMapper);
	});

	it("Failed when services.files.read rejects", async () => {
		const boom = new Error("EPERM");
		const files = makeService({ read: vi.fn(async () => Promise.reject(boom)) });
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.Failed);
		if (result.kind !== PickAndParseKind.Failed) return;
		expect(result.error).toBe(boom);
		expect(result.filename).toBe("contacts.vcf");
	});

	it("EmptyParse when the file is well-formed but produces zero drafts", async () => {
		// A CSV with only a header row — well-formed (not a parse error) but
		// nothing to commit. The UI should say "Nothing to import" rather
		// than opening the confirmation modal on an empty plan.
		const files = makeService({
			requestOpen: vi.fn(async () => [{ handleId: "h", displayName: "empty.csv" }]),
			read: vi.fn(async () => new TextEncoder().encode("Name,Email\r\n")),
		});
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.EmptyParse);
		if (result.kind !== PickAndParseKind.EmptyParse) return;
		expect(result.run.drafts.length).toBe(0);
		expect(result.run.summary).toEqual({ create: 0, merge: 0, skip: 0 });
	});

	it("passes case-insensitive extension to the mapper (CONTACTS.VCF resolves)", async () => {
		const files = makeService({
			requestOpen: vi.fn(async () => [{ handleId: "h", displayName: "CONTACTS.VCF" }]),
			read: vi.fn(async () => new TextEncoder().encode(TWO_PERSON_VCARD)),
		});
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(result.kind).toBe(PickAndParseKind.Ready);
	});

	it("dedupes existing rows so a re-import of the same file lands as Merge, not Create", async () => {
		// The planImport contract is the load-bearing layer for this: passing
		// the existing list through to the mapper must surface the dedupe
		// verdict. A reset-of-existing here would silently strip the
		// duplicate-detection invariant downstream.
		const files = makeService({
			read: vi.fn(async () => new TextEncoder().encode(TWO_PERSON_VCARD)),
		});
		const existing: ExistingEntity[] = [
			{ id: "p_ada", properties: { name: "Ada Lovelace", email: "ada@example.com" } },
		];
		const result = await pickAndParseImport(files, { mappers: MAPPERS, existing });
		if (result.kind !== PickAndParseKind.Ready) throw new Error("expected Ready");
		const plan = result.run.plan as ImportPlanRow[];
		const adaRow = plan.find((r) => (r.draft as { name?: unknown }).name === "Ada Lovelace");
		expect(adaRow?.action).toBe(ImportAction.Merge);
	});

	it("requestOpen receives the dedupe-sorted extension list (vcf, csv) and multi:false", async () => {
		const requestOpen = vi.fn(async () => []);
		const files = makeService({ requestOpen });
		await pickAndParseImport(files, { mappers: MAPPERS, existing: [] });
		expect(requestOpen).toHaveBeenCalledWith({
			filters: [{ name: "Import", extensions: ["csv", "vcf"] }],
			multi: false,
		});
	});

	it("optional title passes through (when set); key omitted (when not)", async () => {
		// `exactOptionalPropertyTypes` care: structurally distinct calls.
		const fA = makeService({ requestOpen: vi.fn(async () => []) });
		await pickAndParseImport(fA, {
			mappers: MAPPERS,
			existing: [],
			title: "Import contacts",
		});
		expect(fA.requestOpen).toHaveBeenCalledWith({
			filters: [{ name: "Import", extensions: ["csv", "vcf"] }],
			multi: false,
			title: "Import contacts",
		});

		const fB = makeService({ requestOpen: vi.fn(async () => []) });
		await pickAndParseImport(fB, { mappers: MAPPERS, existing: [] });
		const lastCall = (fB.requestOpen as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
		expect(lastCall).toBeDefined();
		expect(Object.hasOwn(lastCall, "title")).toBe(false);
	});

	it("filterName overrides the default 'Import' label in the picker filter row", async () => {
		const requestOpen = vi.fn(async () => []);
		const files = makeService({ requestOpen });
		await pickAndParseImport(files, {
			mappers: MAPPERS,
			existing: [],
			filterName: "Contacts (vCard / CSV)",
		});
		const call = (requestOpen as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
		expect(call.filters[0].name).toBe("Contacts (vCard / CSV)");
	});
});

describe("activeImportMappers", () => {
	beforeEach(() => {
		_resetImportRegistryForTests();
	});

	it("returns the contacts mapper after registerBuiltInImportMappers() runs", () => {
		registerBuiltInImportMappers();
		const mappers = activeImportMappers();
		expect(mappers.length).toBeGreaterThanOrEqual(1);
		expect(mappers.find((m) => m.typeUrl === PERSON_TYPE)).toBe(contactsImportMapper);
	});

	it("returns empty list when no mappers have been registered (pre-boot)", () => {
		// No register call — the registry is empty after the reset, so the
		// orchestrator's convenience snapshot reflects "nothing wired yet".
		expect(activeImportMappers()).toEqual([]);
	});

	it("dedupes mappers that serve multiple extensions (one entry per mapper, not per extension)", () => {
		// Contacts serves both vcf + csv; the helper hits the registry twice
		// but should only surface the mapper instance once.
		registerBuiltInImportMappers();
		const mappers = activeImportMappers();
		const contactsCount = mappers.filter((m) => m === contactsImportMapper).length;
		expect(contactsCount).toBe(1);
	});
});
