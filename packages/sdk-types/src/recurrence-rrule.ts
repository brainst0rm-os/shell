/**
 * Map the structured `Recurrence` union to / from an RFC 5545 RRULE string.
 * The structured kinds emit a clean RRULE; `Custom` passes its raw rrule
 * through. On parse, a recognised shape becomes the matching structured
 * kind, and anything the structured forms cannot express degrades to
 * `Custom { rrule }` — never lost, just not introspected.
 *
 * The single shared parser/serializer for the whole vault: Calendar (ICS
 * import/export), Automations reminders, and any future RRULE consumer call
 * this — one RFC-5545 subset, one place to fix.
 */

import {
	type Recurrence,
	RecurrenceKind,
	WEEKDAYS,
	type Weekday,
	isRecurrence,
} from "./recurrence";

/** ISO `Weekday` → the two-letter ICS day code. */
const ICS_DAY: Record<Weekday, string> = {
	mon: "MO",
	tue: "TU",
	wed: "WE",
	thu: "TH",
	fri: "FR",
	sat: "SA",
	sun: "SU",
} as Record<Weekday, string>;

const DAY_FROM_ICS: Record<string, Weekday> = Object.fromEntries(
	WEEKDAYS.map((d) => [ICS_DAY[d], d]),
);

export function recurrenceToRRule(rec: Recurrence): string {
	switch (rec.kind) {
		case RecurrenceKind.Daily:
			return joinRule("DAILY", rec.every);
		case RecurrenceKind.Weekly: {
			const byday = rec.days.map((d) => ICS_DAY[d]).join(",");
			return joinRule("WEEKLY", rec.every, `BYDAY=${byday}`);
		}
		case RecurrenceKind.Monthly: {
			if (rec.dayOfMonth !== undefined) {
				return joinRule("MONTHLY", rec.every, `BYMONTHDAY=${rec.dayOfMonth}`);
			}
			if (rec.dayOfWeek) {
				const code = `${rec.dayOfWeek.ordinal}${ICS_DAY[rec.dayOfWeek.weekday]}`;
				return joinRule("MONTHLY", rec.every, `BYDAY=${code}`);
			}
			return joinRule("MONTHLY", rec.every);
		}
		case RecurrenceKind.Yearly:
			return `FREQ=YEARLY;BYMONTH=${rec.month};BYMONTHDAY=${rec.day}`;
		case RecurrenceKind.Custom:
			return stripRRulePrefix(rec.rrule);
	}
}

function joinRule(freq: string, every: number, ...extra: string[]): string {
	const parts = [`FREQ=${freq}`];
	if (every > 1) parts.push(`INTERVAL=${every}`);
	parts.push(...extra);
	return parts.join(";");
}

/** `RRULE:FREQ=…` or bare `FREQ=…` → the bare rule body. */
export function stripRRulePrefix(raw: string): string {
	return raw.replace(/^RRULE:/i, "").trim();
}

type RuleParts = Map<string, string>;

function parseRuleParts(rrule: string): RuleParts {
	const parts: RuleParts = new Map();
	for (const segment of stripRRulePrefix(rrule).split(";")) {
		const eq = segment.indexOf("=");
		if (eq <= 0) continue;
		parts.set(segment.slice(0, eq).toUpperCase(), segment.slice(eq + 1));
	}
	return parts;
}

function parseInterval(parts: RuleParts): number {
	const raw = Number(parts.get("INTERVAL"));
	return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

/** Parse a single `BYDAY` token that may carry an ordinal prefix
 *  (`2TU`, `-1FR`, `WE`). Returns the weekday + ordinal (ordinal `0` when
 *  none / unusable). */
function parseBydayToken(token: string): { weekday: Weekday; ordinal: number } | null {
	const match = /^(-?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(token.trim().toUpperCase());
	if (!match) return null;
	const weekday = DAY_FROM_ICS[match[2] as string];
	if (!weekday) return null;
	return { weekday, ordinal: match[1] ? Number(match[1]) : 0 };
}

export function rruleToRecurrence(rrule: string): Recurrence | null {
	const raw = stripRRulePrefix(rrule);
	if (raw.length === 0) return null;
	const parts = parseRuleParts(raw);
	const freq = parts.get("FREQ")?.toUpperCase();
	const every = parseInterval(parts);

	const structured = ((): Recurrence | null => {
		switch (freq) {
			case "DAILY":
				return { kind: RecurrenceKind.Daily, every };
			case "WEEKLY": {
				const byday = parts.get("BYDAY");
				if (!byday) return null;
				const days: Weekday[] = [];
				for (const token of byday.split(",")) {
					const parsed = parseBydayToken(token);
					if (parsed) days.push(parsed.weekday);
				}
				if (days.length === 0) return null;
				return { kind: RecurrenceKind.Weekly, every, days };
			}
			case "MONTHLY": {
				const byMonthDay = parts.get("BYMONTHDAY");
				if (byMonthDay) {
					return { kind: RecurrenceKind.Monthly, every, dayOfMonth: Number(byMonthDay) };
				}
				const byday = parts.get("BYDAY");
				if (byday) {
					const parsed = parseBydayToken(byday.split(",")[0] ?? "");
					if (parsed && parsed.ordinal !== 0 && isOrdinal(parsed.ordinal)) {
						return {
							kind: RecurrenceKind.Monthly,
							every,
							dayOfWeek: { weekday: parsed.weekday, ordinal: parsed.ordinal },
						};
					}
				}
				return null;
			}
			case "YEARLY": {
				// `YearlyRecurrence` has no `every` field, so a non-annual yearly
				// (`INTERVAL=2`) cannot be expressed structurally — preserve it
				// verbatim as `Custom` rather than silently firing every year.
				if (every !== 1) return null;
				const month = Number(parts.get("BYMONTH"));
				const day = Number(parts.get("BYMONTHDAY"));
				if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
				return { kind: RecurrenceKind.Yearly, month, day };
			}
			default:
				return null;
		}
	})();

	if (structured && isRecurrence(structured)) return structured;
	// Unrecognised but non-empty → preserve verbatim as Custom.
	return { kind: RecurrenceKind.Custom, rrule: raw };
}

function isOrdinal(n: number): n is 1 | 2 | 3 | 4 | -1 {
	return n === 1 || n === 2 || n === 3 || n === 4 || n === -1;
}
