/**
 * Tasks' `RecurrenceSummaryLabels` pack — feeds the shared
 * `summarizeRecurrence` keystone the app's translated phrases. The builder
 * lives in `@brainstorm/sdk/recurrence-labels` (shared with Calendar); this
 * wires it to the `tasks.recurrence.*` manifest namespace.
 */

import type { RecurrenceSummaryLabels } from "@brainstorm/sdk-types";
import { buildRecurrenceLabels } from "@brainstorm/sdk/recurrence-labels";
import { t } from "./t";

export function recurrenceLabels(): RecurrenceSummaryLabels {
	return buildRecurrenceLabels((key, params) => t(`tasks.recurrence.${key}`, params));
}
