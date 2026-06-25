/**
 * Members-override algorithm — **promoted to `@brainstorm/sdk` (9.3.5.V 7c)**
 * so the shell `collections` host service and this app share one
 * implementation. This module is now a thin re-export bridge (mirrors how
 * `../types/list` re-exports the promoted collection types); the canonical
 * source + tests live in `packages/sdk/src/collections.ts`.
 *
 * Spec: docs/apps/database/10-lists-sets-collections.md §Operations on a List.
 */

export {
	AddOutcome,
	type AddResult,
	MembersCapacityError,
	type MutationContext,
	RemoveOutcome,
	type RemoveResult,
	addToList,
	removeFromList,
} from "@brainstorm/sdk";
