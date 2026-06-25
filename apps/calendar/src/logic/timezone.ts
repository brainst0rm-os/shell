/**
 * IANA time-zone conversion (9.15.21). Pure, built on `Intl.DateTimeFormat`
 * (present in Electron + jsdom). An `Event.timeZone` names the zone its
 * wall-clock times are authored in; the stored `start`/`end` stay absolute
 * epoch-ms instants, so a viewer in a different zone still sees the right
 * moment — only the *editing* + display of the wall-clock needs the zone.
 *
 * `timeZone: null` keeps the historical behaviour: the local wall-clock.
 */

export type WallClock = {
	year: number;
	month: number; // 1..12
	day: number; // 1..31
	hour: number; // 0..23
	minute: number;
	second: number;
};

/** The viewer's local IANA zone (e.g. `Europe/Berlin`). */
export function localTimeZone(): string {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const PARTS_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
	let fmt = PARTS_FORMAT_CACHE.get(tz);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		});
		PARTS_FORMAT_CACHE.set(tz, fmt);
	}
	return fmt;
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
	const raw = parts.find((p) => p.type === type)?.value ?? "0";
	const n = Number(raw);
	// `hour12: false` can render midnight as "24" in some engines.
	return type === "hour" && n === 24 ? 0 : n;
}

/** The wall-clock the instant `utcMs` shows in `tz`. */
export function utcToZonedParts(utcMs: number, tz: string): WallClock {
	const parts = partsFormatter(tz).formatToParts(new Date(utcMs));
	return {
		year: partValue(parts, "year"),
		month: partValue(parts, "month"),
		day: partValue(parts, "day"),
		hour: partValue(parts, "hour"),
		minute: partValue(parts, "minute"),
		second: partValue(parts, "second"),
	};
}

/** `tz`'s UTC offset (ms) at the instant `utcMs` — positive east of UTC. */
export function tzOffsetMs(utcMs: number, tz: string): number {
	const p = utcToZonedParts(utcMs, tz);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return asUtc - utcMs;
}

/** The instant whose wall-clock in `tz` is `wall`. Refines once across a
 *  DST boundary (the initial offset guess can straddle a transition). */
export function zonedTimeToUtc(
	wall: Omit<WallClock, "second"> & { second?: number },
	tz: string,
): number {
	const guess = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour,
		wall.minute,
		wall.second ?? 0,
	);
	const off1 = tzOffsetMs(guess, tz);
	let utc = guess - off1;
	const off2 = tzOffsetMs(utc, tz);
	if (off2 !== off1) utc = guess - off2;
	return utc;
}

/** Short zone label at an instant (e.g. `PST`, `GMT+2`). */
export function tzShortName(utcMs: number, tz: string): string {
	const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" });
	return fmt.formatToParts(new Date(utcMs)).find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** Narrow a stored value to a valid IANA zone, or `null`. */
export function normalizeTimeZone(raw: unknown): string | null {
	if (typeof raw !== "string" || raw.length === 0) return null;
	try {
		// Throws RangeError on an unknown zone.
		new Intl.DateTimeFormat("en-US", { timeZone: raw });
		return raw;
	} catch {
		return null;
	}
}

/** The list of zones a picker offers — the platform's full IANA set when
 *  available (Electron / modern engines), else a small curated fallback.
 *  The viewer's local zone is guaranteed present + first. */
export function listTimeZones(): string[] {
	const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
		.supportedValuesOf;
	const all = supported ? supported("timeZone") : FALLBACK_ZONES;
	// Local + UTC are guaranteed present + first (the platform list may omit
	// the bare `UTC` alias), then every other zone de-duplicated.
	const ordered: string[] = [];
	const seen = new Set<string>();
	for (const zone of [localTimeZone(), "UTC", ...all]) {
		if (seen.has(zone)) continue;
		seen.add(zone);
		ordered.push(zone);
	}
	return ordered;
}

/** The handful of major business hubs a picker surfaces first, before the
 *  full IANA list. UTC and the viewer's local zone are guaranteed present. */
const COMMON_HUB_ZONES: string[] = [
	"UTC",
	"America/Los_Angeles",
	"America/New_York",
	"America/Sao_Paulo",
	"Europe/London",
	"Europe/Berlin",
	"Asia/Dubai",
	"Asia/Kolkata",
	"Asia/Shanghai",
	"Asia/Tokyo",
	"Australia/Sydney",
];

/** The short shortlist a zone picker offers up top: the viewer's local zone
 *  first, then UTC and a few major hubs, de-duplicated and validity-checked.
 *  Resolves F-053 — a once-a-year field shouldn't open onto 400 flat options. */
export function commonTimeZones(): string[] {
	const ordered: string[] = [];
	const seen = new Set<string>();
	for (const zone of [localTimeZone(), ...COMMON_HUB_ZONES]) {
		const norm = normalizeTimeZone(zone);
		if (!norm || seen.has(norm)) continue;
		seen.add(norm);
		ordered.push(norm);
	}
	return ordered;
}

export type TimeZoneGroup = { region: string; zones: string[] };

/** Every IANA zone grouped by its region prefix (the part before the first
 *  "/") with each region's zones sorted; bare ids like `UTC` group under
 *  "Other". For the grouped tail of a zone picker, below the common shortlist. */
export function groupedTimeZones(): TimeZoneGroup[] {
	const byRegion = new Map<string, string[]>();
	for (const zone of listTimeZones()) {
		const slash = zone.indexOf("/");
		const region = slash > 0 ? zone.slice(0, slash) : "Other";
		const bucket = byRegion.get(region);
		if (bucket) bucket.push(zone);
		else byRegion.set(region, [zone]);
	}
	return [...byRegion.entries()]
		.map(([region, zones]) => ({ region, zones: zones.sort((a, b) => a.localeCompare(b)) }))
		.sort((a, b) => a.region.localeCompare(b.region));
}

const FALLBACK_ZONES: string[] = [
	"UTC",
	"America/Los_Angeles",
	"America/Denver",
	"America/Chicago",
	"America/New_York",
	"America/Sao_Paulo",
	"Europe/London",
	"Europe/Berlin",
	"Europe/Moscow",
	"Asia/Dubai",
	"Asia/Kolkata",
	"Asia/Shanghai",
	"Asia/Tokyo",
	"Australia/Sydney",
];
