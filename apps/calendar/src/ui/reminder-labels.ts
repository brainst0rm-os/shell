/**
 * Friendly label for a reminder offset (minutes before start). Shared by
 * the detail surface's preset chips and the scheduler's notification body
 * so "10 min before" reads identically in both places.
 */

import { t } from "../i18n/t";

export function reminderOffsetLabel(minutes: number): string {
	if (minutes <= 0) return t("calendar.reminder.atStart");
	if (minutes === 60) return t("calendar.reminder.hourBefore");
	if (minutes === 1440) return t("calendar.reminder.dayBefore");
	return t("calendar.reminder.minutesBefore", { n: minutes });
}
