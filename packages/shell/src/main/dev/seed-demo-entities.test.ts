/**
 * Verifies the cross-app entities seed writes the SAME real `entities.db`
 * rows every app reads, with the shapes Calendar / Tasks / Notes codecs
 * require — and that it is marker-gated (idempotent, but STILL seeds a
 * vault that already holds the user's / migrated entities; never touches
 * their data).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listVaultEntities } from "../entities/vault-entities-service";
import { DataStores } from "../storage/data-stores";
import { EntitiesRepository } from "../storage/entities-repo/entities-repo";
import type { VaultSession } from "../vault/session";
import { seedDemoEntities } from "./seed-demo-entities";

async function setup() {
	const vaultDir = await mkdtemp(join(tmpdir(), "brainstorm-seed-ent-"));
	const stores = new DataStores(vaultDir);
	const session = { dataStores: stores } as unknown as VaultSession;
	return { vaultDir, stores, session };
}

describe("seedDemoEntities", () => {
	let env: Awaited<ReturnType<typeof setup>>;
	beforeEach(async () => {
		env = await setup();
	});
	afterEach(async () => {
		env.stores.close();
		await rm(env.vaultDir, { recursive: true, force: true });
	});

	it("seeds a coherent multi-type object set into the real entities.db", async () => {
		const result = await seedDemoEntities(env.session);
		expect(result.seeded).toBe(true);
		expect(result.counts).toEqual({
			tasks: 11,
			events: 3,
			notes: 4,
			projects: 2,
			links: 11,
			people: 4,
		});

		const repo = new EntitiesRepository(await env.stores.open("entities"));
		const byType = (t: string) => repo.query({ type: t });

		// 2 cross-app demo projects + the GTM beta-launch project; 11 demo
		// tasks + 45 launch tasks (9 issues + 36 parentId-nested sub-issues).
		expect(byType("brainstorm/Project/v1")).toHaveLength(3);
		expect(byType("brainstorm/Task/v1")).toHaveLength(56);
		expect(byType("brainstorm/Event/v1")).toHaveLength(3);
		expect(byType("io.brainstorm.notes/Note/v1")).toHaveLength(4);
		expect(byType("brainstorm/Person/v1")).toHaveLength(4);
	});

	it("seeds People (Contacts) with composable-model props", async () => {
		await seedDemoEntities(env.session);
		const repo = new EntitiesRepository(await env.stores.open("entities"));
		const people = repo.query({ type: "brainstorm/Person/v1" });
		expect(people).toHaveLength(4);
		for (const p of people) {
			expect(typeof p.properties.name).toBe("string");
			// email is Text + format:email + multi → an array of strings.
			expect(Array.isArray(p.properties.email)).toBe(true);
		}
		// At least one contact links to the launch project.
		expect(
			people.some(
				(p) => Array.isArray(p.properties.links) && p.properties.links.includes("seed_proj_launch"),
			),
		).toBe(true);
	});

	it("dated tasks/events carry the keys Calendar projects on", async () => {
		await seedDemoEntities(env.session);
		const repo = new EntitiesRepository(await env.stores.open("entities"));

		const tasks = repo.query({ type: "brainstorm/Task/v1" });
		const datedTasks = tasks.filter(
			(t) => typeof t.properties.scheduledAt === "number" || typeof t.properties.dueAt === "number",
		);
		// 5 dated demo tasks + 5 dated launch sub-issues (certs/email/handles/
		// waitlist/segment carry a dueAt); the rest are undated backlog.
		expect(datedTasks.length).toBe(10);
		for (const t of tasks) {
			expect(typeof t.properties.name).toBe("string");
			expect(typeof t.properties.createdAt).toBe("number");
		}
		for (const e of repo.query({ type: "brainstorm/Event/v1" })) {
			expect(typeof e.properties.title).toBe("string");
			expect(typeof e.properties.start).toBe("number");
		}
	});

	it("links tasks to their project (Graph edges) + notes carry bodies", async () => {
		await seedDemoEntities(env.session);
		const repo = new EntitiesRepository(await env.stores.open("entities"));

		const links = repo.linksFrom("seed_task_1");
		expect(links).toHaveLength(1);
		expect(links[0]).toMatchObject({
			destEntityId: "seed_proj_launch",
			linkType: "brainstorm/Task/in-project",
		});

		const notes = repo.query({ type: "io.brainstorm.notes/Note/v1" });
		// Every node needs a string `type` — a root without `type:"root"`
		// (or any node missing it) makes Lexical's parseEditorState throw
		// `type "undefined" + not found` and the note opens blank.
		const everyNodeTyped = (node: unknown): boolean => {
			if (!node || typeof node !== "object") return false;
			const rec = node as { type?: unknown; children?: unknown };
			if (typeof rec.type !== "string" || rec.type.length === 0) return false;
			if (Array.isArray(rec.children)) return rec.children.every(everyNodeTyped);
			return true;
		};
		for (const n of notes) {
			expect(typeof n.properties.title).toBe("string");
			expect(n.properties.body).toBeTruthy();
			const root = (n.properties.body as { root?: { type?: unknown } }).root;
			expect(root?.type).toBe("root");
			expect(everyNodeTyped(root)).toBe(true);
		}
		// One note is date-titled so Journal projects it.
		expect(notes.some((n) => /^\d{4}-\d{2}-\d{2}$/.test(String(n.properties.title)))).toBe(true);
	});

	it("end-to-end: the vaultEntities snapshot apps read carries the seeded objects", async () => {
		// The EXACT call the `vaultEntities` broker handler makes
		// (index.ts) — what Graph/Database/Calendar actually receive.
		await seedDemoEntities(env.session);
		const getEntitiesRepo = async () =>
			new EntitiesRepository(await env.stores.open("entities")) as never;
		const snap = await listVaultEntities(env.vaultDir, getEntitiesRepo);
		const byType = (t: string) => snap.entities.filter((e) => e.type === t);
		expect(byType("brainstorm/Task/v1")).toHaveLength(56);
		expect(byType("brainstorm/Event/v1")).toHaveLength(3);
		expect(byType("brainstorm/Project/v1")).toHaveLength(3);
		expect(byType("io.brainstorm.notes/Note/v1")).toHaveLength(4);
		// task→project links survive the aggregator's dangling-link filter.
		expect(snap.links.some((l) => l.linkType === "brainstorm/Task/in-project")).toBe(true);
	});

	it("marker-gated: a second run is a no-op and never duplicates", async () => {
		const first = await seedDemoEntities(env.session);
		expect(first.seeded).toBe(true);
		const second = await seedDemoEntities(env.session);
		expect(second.seeded).toBe(false); // both markers present → no-op

		const repo = new EntitiesRepository(await env.stores.open("entities"));
		expect(repo.query({ type: "brainstorm/Task/v1" })).toHaveLength(56);
	});

	it("STILL seeds a vault that already has the user's / migrated entities", async () => {
		// Reproduces the real bug: Notes migrated into entities.db, so the
		// vault is non-empty. The seed must still populate (marker-gated,
		// not whole-db-empty-gated) and must not touch the user's row.
		const pre = new EntitiesRepository(await env.stores.open("entities"));
		pre.create({
			id: "migrated_note_1",
			type: "io.brainstorm.notes/Note/v1",
			properties: { title: "a real note the user already had" },
			createdBy: "io.brainstorm.notes",
			now: 1,
			dekId: null,
		});
		const result = await seedDemoEntities(env.session);
		expect(result.seeded).toBe(true); // ← the fix
		const repo = new EntitiesRepository(await env.stores.open("entities"));
		expect(repo.query({ type: "brainstorm/Task/v1" })).toHaveLength(56);
		expect(repo.get("migrated_note_1")?.properties.title).toBe("a real note the user already had"); // user data untouched
	});

	it("seeds the GTM beta-launch project as issues + parentId-nested sub-issues", async () => {
		await seedDemoEntities(env.session);
		const repo = new EntitiesRepository(await env.stores.open("entities"));

		const project = repo.get("seed_proj_beta_launch");
		expect(project?.type).toBe("brainstorm/Project/v1");
		expect(project?.properties.name).toBe("Public Beta Launch — GTM");

		// Every launch task belongs to the project and links to it.
		const launchTasks = repo
			.query({ type: "brainstorm/Task/v1" })
			.filter((t) => t.properties.projectId === "seed_proj_beta_launch");
		expect(launchTasks).toHaveLength(45); // 9 issues + 36 sub-issues
		for (const t of launchTasks) {
			expect(repo.linksFrom(t.id)).toContainEqual(
				expect.objectContaining({
					destEntityId: "seed_proj_beta_launch",
					linkType: "brainstorm/Task/in-project",
				}),
			);
			expect(typeof t.properties.notes).toBe("string"); // each issue is descriptive
			expect((t.properties.notes as string).length).toBeGreaterThan(0);
		}

		// Top-level issues have no parent; sub-issues point at a real issue.
		const issues = launchTasks.filter((t) => t.properties.parentId === null);
		const subs = launchTasks.filter((t) => t.properties.parentId !== null);
		expect(issues).toHaveLength(9);
		expect(subs).toHaveLength(36);
		const issueIds = new Set(issues.map((i) => i.id));
		for (const s of subs) {
			expect(issueIds.has(s.properties.parentId as string)).toBe(true);
		}
	});
});
