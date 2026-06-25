/**
 * F-212 — the SHOW filter lists every type present in the vault, which puts
 * plumbing rows (BrowsingSession, ListView, Trigger, Workflow…) on equal
 * visual footing with the user's content types. This partition feeds the
 * chips' *grouping only*: user types render first, system types render last
 * under a dimmed "System" sub-group. Filtering semantics are untouched —
 * both groups stay ordinary toggles over the same pattern subject.
 */

import { isSystemEntityType } from "@brainstorm/sdk/system-entities";
import type { TypeOption } from "./pattern-edit";

export type PartitionedTypeOptions = {
	user: TypeOption[];
	system: TypeOption[];
};

export function partitionTypeOptions(options: readonly TypeOption[]): PartitionedTypeOptions {
	const user: TypeOption[] = [];
	const system: TypeOption[] = [];
	for (const option of options) {
		(isSystemEntityType(option.type) ? system : user).push(option);
	}
	return { user, system };
}
