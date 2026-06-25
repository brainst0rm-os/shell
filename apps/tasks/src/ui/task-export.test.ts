// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TasksBrainstorm } from "../storage/runtime";
import { buildTaskExportItems } from "./task-export";

type ExportSvc = NonNullable<TasksBrainstorm["services"]["export"]>;
type FilesSvc = NonNullable<TasksBrainstorm["services"]["files"]>;

function runtimeWith(over: {
	export?: ExportSvc | null;
	files?: FilesSvc | null;
}): TasksBrainstorm {
	return {
		services: {
			...(over.export ? { export: over.export } : {}),
			...(over.files ? { files: over.files } : {}),
		},
	} as unknown as TasksBrainstorm;
}

function stubFiles() {
	const writes: Uint8Array[] = [];
	const files: FilesSvc = {
		requestSave: async () => ({ handleId: "h1", displayName: "out" }),
		write: async (_h, data) => {
			writes.push(data instanceof Uint8Array ? data : new Uint8Array(data));
		},
	};
	return { files, writes };
}

describe("buildTaskExportItems (IE-8 Tasks adoption)", () => {
	afterEach(() => {
		for (const el of document.querySelectorAll(".bs-popover")) el.remove();
	});

	it("returns no rows when the export service is absent (preview / older shell)", () => {
		const { files } = stubFiles();
		const items = buildTaskExportItems({
			runtime: runtimeWith({ files }),
			entityIds: ["t1"],
			name: "Ship it",
		});
		expect(items).toHaveLength(0);
	});

	it("returns no rows when the files service is absent", () => {
		const items = buildTaskExportItems({
			runtime: runtimeWith({ export: { serializeEntities: async () => "" } }),
			entityIds: ["t1"],
			name: "Ship it",
		});
		expect(items).toHaveLength(0);
	});

	it("builds a single 'Export…' row when both services are present", () => {
		const { files } = stubFiles();
		const items = buildTaskExportItems({
			runtime: runtimeWith({ export: { serializeEntities: async () => "" }, files }),
			entityIds: ["t1"],
			name: "Ship it",
		});
		expect(items).toHaveLength(1);
		expect(items[0]?.id).toBe("export");
		expect(items[0]?.label).toBe("Export…");
	});

	it("uses the plural dialog title when exporting a project's tasks", () => {
		const { files } = stubFiles();
		const [item] = buildTaskExportItems({
			runtime: runtimeWith({ export: { serializeEntities: async () => "" }, files }),
			entityIds: ["t1", "t2"],
			name: "Garden",
			plural: true,
		});
		item?.run();
		expect(document.querySelector(".bs-popover")?.textContent ?? "").toContain("Export tasks");
	});

	it("run() opens the format popover and serialises the task ids on export", async () => {
		const { files, writes } = stubFiles();
		const serializeEntities = vi.fn(async () => "# Ship it\n");
		const [item] = buildTaskExportItems({
			runtime: runtimeWith({ export: { serializeEntities }, files }),
			entityIds: ["t1"],
			name: "Ship it",
		});
		item?.run();
		const popover = document.querySelector(".bs-popover");
		expect(popover?.textContent ?? "").toContain("Markdown");
		// The default format is markdown; drive an export by clicking the action.
		const exportBtn = Array.from(popover?.querySelectorAll("button") ?? []).find((b) =>
			(b.textContent ?? "").includes("Export"),
		);
		exportBtn?.click();
		await vi.waitFor(() => expect(serializeEntities).toHaveBeenCalled());
		expect(serializeEntities).toHaveBeenCalledWith({ ids: ["t1"], format: "markdown" });
		await vi.waitFor(() => expect(writes).toHaveLength(1));
	});
});
