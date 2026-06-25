/**
 * CalDAV contracts (`brainstorm/CalDavAccount|CalDavCalendar/v1`) — the
 * Calendar app's two-way sync connector (9.15.19) over the connector
 * framework (doc 56).
 *
 * A `CalDavAccount/v1` holds server coordinates + the **frozen egress
 * origins** discovered at connect time; a `CalDavCalendar/v1` is one
 * subscribed collection with its incremental `sync-token` and the
 * `knownHrefs` href→etag index the two-way engine uses to detect local
 * deletions. Pulled events land as ordinary `brainstorm/Event/v1` rows
 * tagged with `caldavCalendarRef` + the connector dedupe key.
 *
 * **Custody invariant (doc 56 / 29).** An account entity holds **no
 * secret** — the app-password/Basic credential lives in Tier 2 keyed by
 * the account id; the shell injects `Authorization` into every CalDAV
 * request, the renderer never holds it. `validateCalDavAccount` enforces
 * this structurally, mirroring `validateMailAccount`.
 *
 * **Conflict policy (v1, documented):** server-wins-with-local-redo. A
 * push that fails its `If-Match` etag check (the server copy moved) is
 * not retried — the server copy is pulled and overwrites the local edit,
 * and the run's `conflicts` count surfaces it so the user can redo.
 *
 * Near-leaf: only the `enum-guard` leaf is imported (same discipline as
 * `mail.ts` / `connector.ts`).
 */

import { enumGuard } from "./enum-guard";

export const CALDAV_ACCOUNT_TYPE_URL = "brainstorm/CalDavAccount/v1";
export const CALDAV_CALENDAR_TYPE_URL = "brainstorm/CalDavCalendar/v1";

/** The Event/v1 property linking a pulled/pushed event to its
 *  `CalDavCalendar/v1` row. Flat so the engine's lookup compiles to a
 *  direct `json_extract` match (same shape as `connectorExternalId`). */
export const CALDAV_CALENDAR_REF_PROP = "caldavCalendarRef";

/** Outcome of one `caldav.syncNow` run. */
export type CalDavSyncSummary = {
	calendarRef: string;
	pulled: number;
	pushedCreated: number;
	pushedUpdated: number;
	deletedLocal: number;
	deletedRemote: number;
	conflicts: number;
	startedAt: string;
	finishedAt: string;
};

/** A calendar collection as discovered on the server (pre-subscription). */
export type CalDavCalendarInfo = {
	/** Absolute collection URL. */
	url: string;
	displayName: string;
	/** Apple `calendar-color` when the server publishes one. */
	color: string | null;
	/** False when the collection's supported-component-set excludes VEVENT. */
	supportsEvents: boolean;
	ctag: string | null;
};

export enum CalDavSyncState {
	Idle = "idle",
	Syncing = "syncing",
	Error = "error",
}

export const CALDAV_SYNC_STATES = Object.freeze([
	CalDavSyncState.Idle,
	CalDavSyncState.Syncing,
	CalDavSyncState.Error,
]);

export const isCalDavSyncState = enumGuard(CALDAV_SYNC_STATES);

export type CalDavAccountDef = {
	serverUrl: string;
	principalUrl: string;
	homeUrl: string;
	username: string;
	displayName: string;
	/** Frozen at connect time from the entered server + discovered
	 *  principal/home origins; every request validates against this list. */
	egressOrigins: readonly string[];
	enabled: boolean;
};

export type CalDavCalendarDef = {
	accountRef: string;
	url: string;
	displayName: string;
	color?: string;
	enabled: boolean;
	syncToken?: string;
	/** href → last-seen server etag; the local-deletion ledger. */
	knownHrefs?: Record<string, string>;
};

export enum CalDavIssueCode {
	MissingField = "missing-field",
	SecretOnEntity = "secret-on-entity",
	InvalidUrl = "invalid-url",
}

export type CalDavIssue = { code: CalDavIssueCode; message: string };

const SECRET_SHAPED_FIELDS = ["password", "secret", "token", "accessToken", "refreshToken"];

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:";
	} catch {
		return false;
	}
}

/** Structural validation of an account def — mirrors `validateMailAccount`'s
 *  custody check: a secret-shaped field on the entity is an error. */
export function validateCalDavAccount(def: CalDavAccountDef): CalDavIssue[] {
	const issues: CalDavIssue[] = [];
	for (const field of ["serverUrl", "principalUrl", "homeUrl", "username"] as const) {
		if (typeof def[field] !== "string" || def[field].length === 0) {
			issues.push({ code: CalDavIssueCode.MissingField, message: `${field} is required` });
		}
	}
	for (const field of ["serverUrl", "principalUrl", "homeUrl"] as const) {
		if (typeof def[field] === "string" && def[field].length > 0 && !isHttpUrl(def[field])) {
			issues.push({ code: CalDavIssueCode.InvalidUrl, message: `${field} must be an http(s) URL` });
		}
	}
	if (!Array.isArray(def.egressOrigins) || def.egressOrigins.length === 0) {
		issues.push({ code: CalDavIssueCode.MissingField, message: "egressOrigins is required" });
	}
	for (const field of SECRET_SHAPED_FIELDS) {
		if (field in (def as Record<string, unknown>)) {
			issues.push({
				code: CalDavIssueCode.SecretOnEntity,
				message: `${field} must live in Tier 2, never on the entity`,
			});
		}
	}
	return issues;
}

export function validateCalDavCalendar(def: CalDavCalendarDef): CalDavIssue[] {
	const issues: CalDavIssue[] = [];
	if (typeof def.accountRef !== "string" || def.accountRef.length === 0) {
		issues.push({ code: CalDavIssueCode.MissingField, message: "accountRef is required" });
	}
	if (typeof def.url !== "string" || def.url.length === 0) {
		issues.push({ code: CalDavIssueCode.MissingField, message: "url is required" });
	} else if (!isHttpUrl(def.url)) {
		issues.push({ code: CalDavIssueCode.InvalidUrl, message: "url must be an http(s) URL" });
	}
	if (typeof def.displayName !== "string" || def.displayName.length === 0) {
		issues.push({ code: CalDavIssueCode.MissingField, message: "displayName is required" });
	}
	return issues;
}

/** App-facing CalDAV account + calendar management (9.15.19). The shell
 *  owns credential custody, discovery, and the two-way sync engine; the
 *  app holds only entity refs. Gated on `caldav.manage`, re-checked
 *  server-side. */
export type CalDavService = {
	/** Validate the server with Basic credentials (discovery round-trip),
	 *  create a `CalDavAccount/v1`, and seal the password in Tier 2 — it is
	 *  never returned and never lands on an entity. */
	connect(input: {
		serverUrl: string;
		username: string;
		password: string;
		label?: string;
	}): Promise<{ accountId: string; calendars: CalDavCalendarInfo[] }>;
	/** Re-list the server's calendar collections for an account. */
	listCalendars(input: { accountRef: string }): Promise<CalDavCalendarInfo[]>;
	/** Subscribe one collection — creates the `CalDavCalendar/v1` row. */
	addCalendar(input: {
		accountRef: string;
		url: string;
		displayName: string;
		color?: string;
	}): Promise<{ calendarRef: string }>;
	/** Run a two-way sync for one subscribed calendar now. */
	syncNow(input: { calendarRef: string }): Promise<CalDavSyncSummary>;
	/** Delete the Tier-2 credential and disable the account. */
	disconnect(input: { accountRef: string }): Promise<{ ok: true }>;
};
