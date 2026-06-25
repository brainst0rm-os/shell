import { describe, expect, it } from "vitest";
import type { EntitiesRepository, EntityRow } from "../storage/entities-repo";
import { makeEntityTargetResolver, mimeFromProperties } from "./entity-target";

function fakeRepo(get: (id: string) => EntityRow | null): EntitiesRepository {
	return { get } as unknown as EntitiesRepository;
}

function row(over: Partial<EntityRow>): EntityRow {
	return {
		id: "ent_1",
		type: "io.example/Note/v1",
		spaceId: null,
		properties: {},
		createdBy: "u",
		createdAt: 0,
		updatedAt: 0,
		...over,
	};
}

describe("mimeFromProperties", () => {
	it("reads `mime` first", () => {
		expect(mimeFromProperties({ mime: "image/png", mimeType: "text/plain" })).toBe("image/png");
	});
	it("falls back to `mimeType`", () => {
		expect(mimeFromProperties({ mimeType: "application/pdf" })).toBe("application/pdf");
	});
	it("ignores empty / non-string values", () => {
		expect(mimeFromProperties({ mime: "", mimeType: 42 })).toBeUndefined();
		expect(mimeFromProperties({})).toBeUndefined();
	});
});

describe("makeEntityTargetResolver", () => {
	it("returns null when no vault session is open", async () => {
		const resolve = makeEntityTargetResolver(async () => null);
		expect(await resolve("ent_1")).toBeNull();
	});

	it("returns null for an unknown / soft-deleted id", async () => {
		const resolve = makeEntityTargetResolver(async () => fakeRepo(() => null));
		expect(await resolve("ent_missing")).toBeNull();
	});

	it("returns the bare type when the entity has no MIME", async () => {
		const resolve = makeEntityTargetResolver(async () =>
			fakeRepo(() => row({ type: "io.brainstorm.notes/Note/v1" })),
		);
		expect(await resolve("ent_1")).toEqual({ type: "io.brainstorm.notes/Note/v1" });
	});

	it("includes the MIME for a file-shaped entity", async () => {
		const resolve = makeEntityTargetResolver(async () =>
			fakeRepo(() => row({ type: "io.brainstorm.files/File/v1", properties: { mime: "image/png" } })),
		);
		expect(await resolve("ent_1")).toEqual({
			type: "io.brainstorm.files/File/v1",
			mime: "image/png",
		});
	});

	it("never throws — a repo failure resolves to null", async () => {
		const resolve = makeEntityTargetResolver(async () =>
			fakeRepo(() => {
				throw new Error("db closed mid-switch");
			}),
		);
		expect(await resolve("ent_1")).toBeNull();
	});
});
