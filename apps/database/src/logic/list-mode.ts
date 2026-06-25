/**
 * Derive the user-facing mode label for a List from its shape.
 * See §The three modes.
 *
 * The mode is never stored — it's a function of `source` + `members`. The
 * UI shows a mode badge ("Query" / "Manual" / "Hybrid") computed via this
 * helper; promote / demote / snapshot operations move the List between
 * shape configurations, and the badge follows.
 */

import type { List } from "../types/list";
import { ListMode } from "../types/list-source";

export function deriveListMode(list: Pick<List, "source" | "members">): ListMode {
	const hasOverrides = list.members.include.length > 0 || list.members.exclude.length > 0;
	if (list.source === null) return ListMode.Manual;
	if (!hasOverrides) return ListMode.Query;
	return ListMode.Hybrid;
}
