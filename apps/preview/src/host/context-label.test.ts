import { describe, expect, it } from "vitest";
import { PreviewContextKind } from "../types/preview-context";
import { chipLabelFor } from "./context-label";

describe("chipLabelFor", () => {
	it("hides the chip for no context or a single-file context", () => {
		expect(chipLabelFor(null, 0)).toBeNull();
		expect(chipLabelFor({ kind: PreviewContextKind.Single }, 1)).toBeNull();
	});

	it("prefixes the supplied label per kind", () => {
		expect(chipLabelFor({ kind: PreviewContextKind.Folder, label: "Shots" }, 3)).toEqual({
			label: "From folder: Shots",
			kind: PreviewContextKind.Folder,
		});
		expect(chipLabelFor({ kind: PreviewContextKind.Note, label: "Trip" }, 2)).toEqual({
			label: "From note: Trip",
			kind: PreviewContextKind.Note,
		});
	});

	it("falls back to a per-kind default + item count for a selection", () => {
		expect(chipLabelFor({ kind: PreviewContextKind.Selection }, 1)?.label).toBe("Selection: 1 item");
		expect(chipLabelFor({ kind: PreviewContextKind.Selection }, 4)?.label).toBe("Selection: 4 items");
		expect(chipLabelFor({ kind: PreviewContextKind.Note }, 0)?.label).toBe(
			"From note: Untitled note",
		);
	});
});
