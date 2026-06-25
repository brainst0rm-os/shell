// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { type VCardContact, serializeVCards } from "../logic/vcard";
import type { ContactsFileHandle, ContactsFilesService } from "../runtime";
import { exportContactsToVCard, importContactsFromVCard } from "./vcard-actions";

function contact(over: Partial<VCardContact> = {}): VCardContact {
	return {
		name: "Ada Okafor",
		emails: ["ada@x.com"],
		phones: [],
		org: null,
		role: null,
		birthday: null,
		anniversary: null,
		note: null,
		...over,
	};
}

const HANDLE: ContactsFileHandle = { handleId: "h1", displayName: "contacts.vcf" };

describe("exportContactsToVCard", () => {
	it("notifies on the success path after writing", async () => {
		const files: ContactsFilesService = {
			requestOpen: vi.fn(async () => []),
			requestSave: vi.fn(async () => HANDLE),
			read: vi.fn(async () => new Uint8Array()),
			write: vi.fn(async () => undefined),
		};
		const notify = vi.fn();
		await exportContactsToVCard(files, [contact()], notify);
		expect(files.write).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("notifies + no-ops on an empty contact list", async () => {
		const files: ContactsFilesService = {
			requestOpen: vi.fn(async () => []),
			requestSave: vi.fn(async () => HANDLE),
			read: vi.fn(async () => new Uint8Array()),
			write: vi.fn(async () => undefined),
		};
		const notify = vi.fn();
		await exportContactsToVCard(files, [], notify);
		expect(files.requestSave).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledTimes(1);
	});
});

describe("importContactsFromVCard", () => {
	it("hands parsed contacts to onImport and notifies on success", async () => {
		const vcf = serializeVCards([contact({ name: "Imported" })]);
		const files: ContactsFilesService = {
			requestOpen: vi.fn(async () => [HANDLE]),
			requestSave: vi.fn(async () => null as never),
			read: vi.fn(async () => new TextEncoder().encode(vcf)),
			write: vi.fn(async () => undefined),
		};
		const onImport = vi.fn();
		const notify = vi.fn();
		await importContactsFromVCard(files, onImport, notify);
		expect(onImport).toHaveBeenCalledTimes(1);
		const imported = onImport.mock.calls[0]?.[0] as VCardContact[];
		expect(imported[0]?.name).toBe("Imported");
		expect(notify).toHaveBeenCalledTimes(1);
	});

	it("notifies when the chosen files hold no contacts", async () => {
		const files: ContactsFilesService = {
			requestOpen: vi.fn(async () => [HANDLE]),
			requestSave: vi.fn(async () => null as never),
			read: vi.fn(async () => new TextEncoder().encode("not a vcard")),
			write: vi.fn(async () => undefined),
		};
		const onImport = vi.fn();
		const notify = vi.fn();
		await importContactsFromVCard(files, onImport, notify);
		expect(onImport).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledTimes(1);
	});
});
