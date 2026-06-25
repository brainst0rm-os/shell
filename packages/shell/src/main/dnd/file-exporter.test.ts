import { describe, expect, it, vi } from "vitest";
import { type DragStartTarget, createFileExporter, safeExportFilename } from "./file-exporter";

describe("safeExportFilename", () => {
	it("keeps a normal name with extension", () => {
		expect(safeExportFilename("Report Q3.pdf")).toBe("Report Q3.pdf");
	});

	it("reduces a path to its basename (no traversal out of the temp dir)", () => {
		expect(safeExportFilename("../../etc/passwd")).toBe("passwd");
		expect(safeExportFilename("/abs/secret.key")).toBe("secret.key");
		expect(safeExportFilename("a\\b\\c.txt")).toBe("c.txt");
	});

	it("strips control + reserved filesystem chars", () => {
		expect(safeExportFilename('na:me"<>|?*.txt')).toBe("name.txt");
		expect(safeExportFilename("tab\tnl\nfile.txt")).toBe("tabnlfile.txt");
	});

	it("strips a leading-dot (hidden / dotdot) prefix and falls back when empty", () => {
		expect(safeExportFilename("...")).toBe("file");
		expect(safeExportFilename("")).toBe("file");
		expect(safeExportFilename("   ")).toBe("file");
	});

	it("clamps very long names", () => {
		expect(safeExportFilename("x".repeat(500)).length).toBe(200);
	});
});

describe("createFileExporter", () => {
	function deps(over: Partial<Parameters<typeof createFileExporter>[0]> = {}) {
		const startDrag = vi.fn();
		const win: DragStartTarget = { startDrag };
		return {
			startDrag,
			opts: {
				resolveWindow: () => win,
				writeTemp: vi.fn(async (filename: string) => `/tmp/bs-drag-x/${filename}`),
				dragIcon: () => "icon",
				...over,
			},
		};
	}

	it("writes the bytes to temp and starts the OS drag on the app's window", async () => {
		const { startDrag, opts } = deps();
		const exporter = createFileExporter(opts);
		const ok = await exporter("io.brainstorm.files", {
			name: "../a.pdf",
			bytes: new Uint8Array([1, 2, 3]),
		});
		expect(ok).toBe(true);
		expect(opts.writeTemp).toHaveBeenCalledWith("a.pdf", new Uint8Array([1, 2, 3]));
		expect(startDrag).toHaveBeenCalledWith({ file: "/tmp/bs-drag-x/a.pdf", icon: "icon" });
	});

	it("returns false (no drag) when the source window can't be resolved", async () => {
		const exporter = createFileExporter({
			resolveWindow: () => null,
			writeTemp: vi.fn(),
			dragIcon: () => "icon",
		});
		expect(await exporter("io.brainstorm.files", { name: "a.pdf", bytes: new Uint8Array([1]) })).toBe(
			false,
		);
	});

	it("returns false when the temp write fails (fail-closed)", async () => {
		const { opts } = deps({
			writeTemp: vi.fn(async () => {
				throw new Error("disk full");
			}),
		});
		expect(
			await createFileExporter(opts)("io.brainstorm.files", { name: "a", bytes: new Uint8Array([1]) }),
		).toBe(false);
	});
});
