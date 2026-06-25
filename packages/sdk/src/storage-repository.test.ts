import { describe, expect, it, vi } from "vitest";
import {
	type EntitiesLike,
	type EntityRow,
	type KvStorage,
	createEntityRepository,
	createKvRepository,
	importKvRows,
	listParsedRows,
	queryEntityRows,
	upsertEntity,
} from "./storage-repository";

type Thing = { id: string; name: string };
const parseThing = (raw: unknown): Thing | null =>
	raw && typeof raw === "object" && typeof (raw as Thing).id === "string" ? (raw as Thing) : null;

function fakeKv(initial: KvStorage["list"] extends never ? never : Record<string, unknown> = {}): {
	storage: KvStorage;
	store: Map<string, unknown>;
} {
	const store = new Map<string, unknown>(Object.entries(initial));
	return {
		store,
		storage: {
			put: async (k, v) => void store.set(k, v),
			delete: async (k) => store.delete(k),
			list: async (prefix) => {
				const out: Array<{ key: string; value: unknown }> = [];
				for (const [key, value] of store)
					if (!prefix || key.startsWith(prefix)) out.push({ key, value });
				return out;
			},
		},
	};
}

const noLog = () => {};

describe("listParsedRows", () => {
	it("parses matching rows and drops invalid ones; logs + [] on list failure", async () => {
		const { storage } = fakeKv({ "t:1": { id: "1", name: "a" }, "t:2": { bad: true }, "x:9": 1 });
		expect(await listParsedRows(storage, "t:", parseThing, "listAll", noLog)).toEqual([
			{ id: "1", name: "a" },
		]);

		const log = vi.fn();
		const boom: KvStorage = { ...storage, list: async () => Promise.reject(new Error("io")) };
		expect(await listParsedRows(boom, "t:", parseThing, "listAll", log)).toEqual([]);
		expect(log).toHaveBeenCalledWith("listAll", expect.any(Error));
	});
});

describe("createKvRepository", () => {
	it("round-trips save / listAll / remove", async () => {
		const { storage } = fakeKv();
		const repo = createKvRepository<Thing>(storage, {
			keyPrefix: "t:",
			key: (id) => `t:${id}`,
			getId: (e) => e.id,
			parse: parseThing,
			serialize: (e) => e,
			log: noLog,
		});
		await repo.save({ id: "1", name: "a" });
		await repo.save({ id: "2", name: "b" });
		expect((await repo.listAll()).map((t) => t.id).sort()).toEqual(["1", "2"]);
		await repo.remove("1");
		expect((await repo.listAll()).map((t) => t.id)).toEqual(["2"]);
	});
});

describe("entities helpers", () => {
	function fakeEntities(): { entities: EntitiesLike; rows: Map<string, EntityRow> } {
		const rows = new Map<string, EntityRow>();
		return {
			rows,
			entities: {
				get: async (id) => rows.get(id) ?? null,
				query: async ({ type }) => {
					const types = type === undefined ? null : Array.isArray(type) ? type : [type];
					return [...rows.values()].filter((r) => !types || types.includes(r.type));
				},
				create: async (type, properties, id) => {
					const row = { id: id ?? `gen-${rows.size}`, type, properties };
					rows.set(row.id, row);
					return row;
				},
				update: async (id, patch) => {
					const row = rows.get(id);
					if (row) row.properties = { ...row.properties, ...patch };
					return row;
				},
				delete: async (id) => void rows.delete(id),
			},
		};
	}

	it("upsertEntity creates then updates keyed on the stable id", async () => {
		const { entities, rows } = fakeEntities();
		await upsertEntity(entities, "Thing/v1", "1", { name: "a" }, "save", noLog);
		expect(rows.get("1")?.properties).toEqual({ name: "a" });
		await upsertEntity(entities, "Thing/v1", "1", { name: "b" }, "save", noLog);
		expect(rows.get("1")?.properties).toEqual({ name: "b" });
		expect(rows.size).toBe(1);
	});

	it("queryEntityRows logs + [] on failure", async () => {
		const log = vi.fn();
		const broken: EntitiesLike = {
			...fakeEntities().entities,
			query: async () => Promise.reject(new Error("q")),
		};
		expect(await queryEntityRows(broken, "Thing/v1", "listAll", log)).toEqual([]);
		expect(log).toHaveBeenCalledWith("listAll", expect.any(Error));
	});

	it("createEntityRepository round-trips and filters by type", async () => {
		const { entities, rows } = fakeEntities();
		rows.set("other", { id: "other", type: "Else/v1", properties: {} });
		const repo = createEntityRepository<Thing>(entities, {
			type: "Thing/v1",
			getId: (e) => e.id,
			toProps: ({ id: _id, ...rest }) => rest,
			fromEntity: (e) => parseThing({ ...e.properties, id: e.id }),
			log: noLog,
		});
		await repo.save({ id: "1", name: "a" });
		expect(await repo.listAll()).toEqual([{ id: "1", name: "a" }]);
		await repo.remove("1");
		expect(await repo.listAll()).toEqual([]);
	});
});

describe("importKvRows", () => {
	it("copies parseable rows through save and counts them", async () => {
		const { storage } = fakeKv({
			"t:1": { id: "1", name: "a" },
			"t:2": { id: "2", name: "b" },
			"t:x": {},
		});
		const saved: Thing[] = [];
		const n = await importKvRows(
			storage,
			"t:",
			parseThing,
			async (e) => void saved.push(e),
			"importKv",
			noLog,
		);
		expect(n).toBe(2);
		expect(saved.map((t) => t.id).sort()).toEqual(["1", "2"]);
	});
});
