import { beforeEach, describe, expect, it } from "vitest";
import {
	type CalendarObject,
	DeleteOutcome,
	PutOutcome,
	type SyncCollectionResult,
} from "./caldav-client";
import {
	CALDAV_SOURCE_PROP,
	CONNECTOR_EXTERNAL_ID_PROP,
	type CalDavSource,
	CalDavSyncEngine,
	type CalDavSyncPorts,
	EVENT_TYPE_URL,
	type LocalEventRow,
	caldavExternalKey,
} from "./caldav-sync-engine";

const CAL_URL = "https://dav.example.com/cal/work/";
const CAL_REF = "calendar-entity-1";
const T0 = Date.UTC(2026, 5, 11, 9, 0, 0);

function serverIcs(uid: string, summary: string, startIso = "20260620T100000Z"): string {
	return [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"BEGIN:VEVENT",
		`UID:${uid}`,
		"DTSTAMP:20260610T000000Z",
		"LAST-MODIFIED:20260610T000000Z",
		`DTSTART:${startIso}`,
		`SUMMARY:${summary}`,
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");
}

/** An in-memory CalDAV server + entity store the engine syncs against. */
class Fake {
	server = new Map<string, { etag: string; ics: string }>();
	private tokenCounter = 1;
	serverToken = "tok-1";
	entities = new Map<string, LocalEventRow>();
	private nextEntity = 1;
	private nextEtag = 1;
	private uidCounter = 1;
	putConflictHrefs = new Set<string>();
	deleteConflictHrefs = new Set<string>();
	rejectSyncToken = false;
	puts: string[] = [];
	deletes: string[] = [];

	private bumpToken(): void {
		this.serverToken = `tok-${++this.tokenCounter}`;
	}

	serverPut(href: string, ics: string): void {
		this.server.set(href, { etag: `"s${this.nextEtag++}"`, ics });
		this.bumpToken();
	}

	serverDelete(href: string): void {
		this.server.delete(href);
		this.bumpToken();
	}

	addLocal(properties: Record<string, unknown>): LocalEventRow {
		const row: LocalEventRow = { id: `e${this.nextEntity++}`, properties };
		this.entities.set(row.id, row);
		return row;
	}

	localByExternal(href: string): LocalEventRow | undefined {
		for (const row of this.entities.values()) {
			if (row.properties[CONNECTOR_EXTERNAL_ID_PROP] === caldavExternalKey(href)) return row;
		}
		return undefined;
	}

	ports(): CalDavSyncPorts {
		return {
			client: {
				// Token-aware like a real RFC 6578 server: a current token yields
				// an empty delta; a stale one yields the full member list (a
				// superset of the true delta — legal per the RFC).
				syncCollection: (_url, token): Promise<SyncCollectionResult> => {
					if (this.rejectSyncToken) {
						return Promise.resolve({
							changed: [],
							removed: [],
							syncToken: null,
							fullResyncRequired: true,
						});
					}
					const changed =
						token === this.serverToken
							? []
							: [...this.server.entries()].map(([href, v]) => ({ href, etag: v.etag }));
					return Promise.resolve({
						changed,
						removed: [],
						syncToken: this.serverToken,
						fullResyncRequired: false,
					});
				},
				listEventHrefs: () =>
					Promise.resolve([...this.server.entries()].map(([href, v]) => ({ href, etag: v.etag }))),
				multiGet: (_url, hrefs): Promise<CalendarObject[]> =>
					Promise.resolve(
						hrefs.flatMap((href) => {
							const entry = this.server.get(href);
							return entry ? [{ href, etag: entry.etag, ics: entry.ics }] : [];
						}),
					),
				putEvent: (input) => {
					this.puts.push(input.url);
					if (this.putConflictHrefs.has(input.url)) {
						return Promise.resolve({ outcome: PutOutcome.Conflict, etag: null });
					}
					const etag = `"s${this.nextEtag++}"`;
					this.server.set(input.url, { etag, ics: input.ics });
					return Promise.resolve({
						outcome: input.etag === undefined ? PutOutcome.Created : PutOutcome.Updated,
						etag,
					});
				},
				deleteEvent: (url) => {
					this.deletes.push(url);
					if (this.deleteConflictHrefs.has(url)) return Promise.resolve(DeleteOutcome.Conflict);
					const existed = this.server.delete(url);
					return Promise.resolve(existed ? DeleteOutcome.Deleted : DeleteOutcome.Missing);
				},
			},
			listLocalEvents: () =>
				Promise.resolve(
					[...this.entities.values()].filter((row) => row.properties.caldavCalendarRef === CAL_REF),
				),
			createEntity: (type, properties) => {
				expect(type).toBe(EVENT_TYPE_URL);
				const row = this.addLocal({ ...properties, caldavCalendarRef: CAL_REF });
				return Promise.resolve({ id: row.id });
			},
			updateEntity: (id, patch) => {
				const row = this.entities.get(id);
				if (row) row.properties = { ...row.properties, ...patch };
				return Promise.resolve();
			},
			deleteEntity: (id) => {
				this.entities.delete(id);
				return Promise.resolve();
			},
			now: () => T0,
			newUid: () => `uid-${this.uidCounter++}`,
		};
	}
}

function sourceOf(row: LocalEventRow | undefined): CalDavSource {
	const source = row?.properties[CALDAV_SOURCE_PROP] as CalDavSource | undefined;
	if (!source) throw new Error("expected a caldav.source");
	return source;
}

describe("CalDavSyncEngine — pull", () => {
	let fake: Fake;
	beforeEach(() => {
		fake = new Fake();
	});

	it("initial pull projects server events into Event/v1 rows with provenance", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "Server event A"));
		fake.serverPut(`${CAL_URL}b.ics`, serverIcs("uid-b", "Server event B"));

		const engine = new CalDavSyncEngine(fake.ports());
		const outcome = await engine.syncCalendar({
			calendarRef: CAL_REF,
			calendarUrl: CAL_URL,
			syncToken: null,
			knownHrefs: {},
		});

		expect(outcome.summary.pulled).toBe(2);
		expect(outcome.summary.conflicts).toBe(0);
		expect(outcome.nextSyncToken).toBe(fake.serverToken);
		expect(fake.entities.size).toBe(2);
		const row = fake.localByExternal(`${CAL_URL}a.ics`);
		expect(row?.properties.title).toBe("Server event A");
		expect(sourceOf(row).uid).toBe("uid-a");
		expect(outcome.knownHrefs[`${CAL_URL}a.ics`]).toBe(sourceOf(row).etag);
	});

	it("re-running an unchanged sync is a no-op (idempotent on etag)", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "Stable"));
		const engine = new CalDavSyncEngine(fake.ports());
		const state = { calendarRef: CAL_REF, calendarUrl: CAL_URL, syncToken: null, knownHrefs: {} };
		const first = await engine.syncCalendar(state);
		const second = await engine.syncCalendar({
			...state,
			syncToken: first.nextSyncToken,
			knownHrefs: first.knownHrefs,
		});
		expect(second.summary.pulled).toBe(0);
		expect(second.summary.pushedUpdated).toBe(0);
		expect(fake.entities.size).toBe(1);
	});

	it("a server-side delete removes the local row", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "Doomed"));
		const engine = new CalDavSyncEngine(fake.ports());
		const state = { calendarRef: CAL_REF, calendarUrl: CAL_URL, syncToken: null, knownHrefs: {} };
		const first = await engine.syncCalendar(state);
		expect(fake.entities.size).toBe(1);

		fake.server.delete(`${CAL_URL}a.ics`);
		fake.rejectSyncToken = true; // exercise the full-resync diff path too
		const second = await engine.syncCalendar({
			...state,
			syncToken: first.nextSyncToken,
			knownHrefs: first.knownHrefs,
		});
		expect(second.summary.deletedLocal).toBe(1);
		expect(fake.entities.size).toBe(0);
		expect(second.knownHrefs[`${CAL_URL}a.ics`]).toBeUndefined();
	});

	it("an expired sync-token falls back to the full listing without re-pulling unchanged events", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "Kept"));
		const engine = new CalDavSyncEngine(fake.ports());
		const state = { calendarRef: CAL_REF, calendarUrl: CAL_URL, syncToken: null, knownHrefs: {} };
		const first = await engine.syncCalendar(state);

		fake.rejectSyncToken = true;
		const second = await engine.syncCalendar({
			...state,
			syncToken: "expired",
			knownHrefs: first.knownHrefs,
		});
		expect(second.summary.pulled).toBe(0);
		// Token did not advance — the next run retries sync-collection.
		expect(second.nextSyncToken).toBe("expired");
	});
});

describe("CalDavSyncEngine — push", () => {
	let fake: Fake;
	beforeEach(() => {
		fake = new Fake();
	});

	it("a locally created event PUTs with a fresh UID and records its server coords", async () => {
		fake.addLocal({
			caldavCalendarRef: CAL_REF,
			title: "Local newborn",
			start: Date.UTC(2026, 5, 25, 9, 0, 0),
			allDay: false,
			updatedAt: T0 - 1000,
		});
		const engine = new CalDavSyncEngine(fake.ports());
		const outcome = await engine.syncCalendar({
			calendarRef: CAL_REF,
			calendarUrl: CAL_URL,
			syncToken: null,
			knownHrefs: {},
		});

		expect(outcome.summary.pushedCreated).toBe(1);
		expect(fake.puts).toEqual([`${CAL_URL}uid-1.ics`]);
		const row = fake.localByExternal(`${CAL_URL}uid-1.ics`);
		expect(sourceOf(row).etag).toBe(fake.server.get(`${CAL_URL}uid-1.ics`)?.etag);
		expect(outcome.knownHrefs[`${CAL_URL}uid-1.ics`]).toBeDefined();
		// Watermark set: an immediate re-run pushes nothing.
		const again = await engine.syncCalendar({
			calendarRef: CAL_REF,
			calendarUrl: CAL_URL,
			syncToken: outcome.nextSyncToken,
			knownHrefs: outcome.knownHrefs,
		});
		expect(again.summary.pushedCreated).toBe(0);
		expect(again.summary.pushedUpdated).toBe(0);
	});

	it("a local edit PUTs with If-Match and advances the watermark", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "Original"));
		const engine = new CalDavSyncEngine(fake.ports());
		const state = { calendarRef: CAL_REF, calendarUrl: CAL_URL, syncToken: null, knownHrefs: {} };
		const first = await engine.syncCalendar(state);

		// App edits the synced row: bumps updatedAt off the watermark.
		const row = fake.localByExternal(`${CAL_URL}a.ics`);
		if (!row) throw new Error("expected pulled row");
		row.properties = { ...row.properties, title: "Edited locally", updatedAt: T0 + 5000 };

		const second = await engine.syncCalendar({
			...state,
			syncToken: first.nextSyncToken,
			knownHrefs: first.knownHrefs,
		});
		expect(second.summary.pushedUpdated).toBe(1);
		expect(second.summary.conflicts).toBe(0);
		expect(fake.server.get(`${CAL_URL}a.ics`)?.ics).toContain("SUMMARY:Edited locally");

		const third = await engine.syncCalendar({
			...state,
			syncToken: second.nextSyncToken,
			knownHrefs: second.knownHrefs,
		});
		expect(third.summary.pushedUpdated).toBe(0);
	});

	it("a locally deleted event DELETEs on the server via the knownHrefs ledger", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "To remove"));
		const engine = new CalDavSyncEngine(fake.ports());
		const state = { calendarRef: CAL_REF, calendarUrl: CAL_URL, syncToken: null, knownHrefs: {} };
		const first = await engine.syncCalendar(state);

		const row = fake.localByExternal(`${CAL_URL}a.ics`);
		if (!row) throw new Error("expected pulled row");
		fake.entities.delete(row.id); // user deletes locally; server unchanged

		const second = await engine.syncCalendar({
			...state,
			syncToken: first.nextSyncToken,
			knownHrefs: first.knownHrefs,
		});
		expect(second.summary.deletedRemote).toBe(1);
		expect(fake.deletes).toEqual([`${CAL_URL}a.ics`]);
		expect(fake.server.has(`${CAL_URL}a.ics`)).toBe(false);
		expect(second.knownHrefs[`${CAL_URL}a.ics`]).toBeUndefined();
	});
});

describe("CalDavSyncEngine — conflicts (server-wins with local redo)", () => {
	let fake: Fake;
	beforeEach(() => {
		fake = new Fake();
	});

	it("server + local both edited: the pull adopts the server copy and counts a conflict", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "v1"));
		const engine = new CalDavSyncEngine(fake.ports());
		const state = { calendarRef: CAL_REF, calendarUrl: CAL_URL, syncToken: null, knownHrefs: {} };
		const first = await engine.syncCalendar(state);

		const row = fake.localByExternal(`${CAL_URL}a.ics`);
		if (!row) throw new Error("expected pulled row");
		row.properties = { ...row.properties, title: "local v2", updatedAt: T0 + 5000 };
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "server v2")); // new etag

		const second = await engine.syncCalendar({
			...state,
			syncToken: first.nextSyncToken,
			knownHrefs: first.knownHrefs,
		});
		expect(second.summary.conflicts).toBe(1);
		expect(second.summary.pushedUpdated).toBe(0); // local edit was NOT pushed
		expect(fake.localByExternal(`${CAL_URL}a.ics`)?.properties.title).toBe("server v2");
		// The server copy was never overwritten by the loser.
		expect(fake.server.get(`${CAL_URL}a.ics`)?.ics).toContain("SUMMARY:server v2");
	});

	it("a 412 on push re-pulls the server copy over the local edit", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "v1"));
		const engine = new CalDavSyncEngine(fake.ports());
		const state = { calendarRef: CAL_REF, calendarUrl: CAL_URL, syncToken: null, knownHrefs: {} };
		const first = await engine.syncCalendar(state);

		const row = fake.localByExternal(`${CAL_URL}a.ics`);
		if (!row) throw new Error("expected pulled row");
		row.properties = { ...row.properties, title: "local v2", updatedAt: T0 + 5000 };
		// Server changed AFTER our delta was computed — the PUT hits a 412.
		fake.putConflictHrefs.add(`${CAL_URL}a.ics`);
		const racedEtag = first.knownHrefs[`${CAL_URL}a.ics`] ?? '"s0"';
		fake.server.set(`${CAL_URL}a.ics`, { etag: racedEtag, ics: serverIcs("uid-a", "server raced") });

		const second = await engine.syncCalendar({
			...state,
			syncToken: first.nextSyncToken,
			knownHrefs: first.knownHrefs,
		});
		expect(second.summary.conflicts).toBe(1);
		expect(second.summary.pushedUpdated).toBe(0);
		expect(fake.localByExternal(`${CAL_URL}a.ics`)?.properties.title).toBe("server raced");
	});

	it("a 412 on a pushed delete resurrects the server copy locally", async () => {
		fake.serverPut(`${CAL_URL}a.ics`, serverIcs("uid-a", "kept by server"));
		const engine = new CalDavSyncEngine(fake.ports());
		const state = { calendarRef: CAL_REF, calendarUrl: CAL_URL, syncToken: null, knownHrefs: {} };
		const first = await engine.syncCalendar(state);

		const row = fake.localByExternal(`${CAL_URL}a.ics`);
		if (!row) throw new Error("expected pulled row");
		fake.entities.delete(row.id);
		fake.deleteConflictHrefs.add(`${CAL_URL}a.ics`);
		// Keep the etag stable so the pull phase sees no change.
		const etag = first.knownHrefs[`${CAL_URL}a.ics`] ?? '"s0"';
		fake.server.set(`${CAL_URL}a.ics`, { etag, ics: serverIcs("uid-a", "kept by server") });

		const second = await engine.syncCalendar({
			...state,
			syncToken: first.nextSyncToken,
			knownHrefs: first.knownHrefs,
		});
		expect(second.summary.conflicts).toBe(1);
		expect(second.summary.deletedRemote).toBe(0);
		expect(fake.localByExternal(`${CAL_URL}a.ics`)?.properties.title).toBe("kept by server");
		expect(fake.server.has(`${CAL_URL}a.ics`)).toBe(true);
	});
});
