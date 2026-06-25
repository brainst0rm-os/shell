/**
 * Shell-derived link-type discriminators — the `linkType` strings the
 * entities pipeline stamps on the `links` table for structured edges
 * between first-party objects (Task→Project, Iteration→Stage, …).
 *
 * These are part of the on-disk + wire contract (a stored link row carries
 * the string verbatim; the Graph app filters on it), so the value of each
 * constant is pinned. Centralised here — not in any one feature or the
 * (now-removed) kv bridge — so the live read path, the seeder projection,
 * and the Graph renderer all reference the same names.
 */

export const TASK_IN_PROJECT_LINK_TYPE = "brainstorm/Task/in-project" as const;
export const ITERATION_IN_STAGE_LINK_TYPE = "brainstorm/Iteration/in-stage" as const;
export const ITERATION_RESOLVES_OQ_LINK_TYPE = "brainstorm/Iteration/resolves-oq" as const;
export const STAGE_IN_RELEASE_LINK_TYPE = "brainstorm/Stage/in-release" as const;
export const MILESTONE_IN_RELEASE_LINK_TYPE = "brainstorm/Milestone/in-release" as const;
export const STAGE_GATED_BY_MILESTONE_LINK_TYPE = "brainstorm/Stage/gated-by" as const;
