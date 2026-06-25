/**
 * Type-level surface for the Tasks app's two canonical entity types
 * (`brainstorm/Task/v1`, `brainstorm/Project/v1`) plus the surface-view
 * + priority enums documented in the Stage 9.14 implementation plan.
 *
 * Stage 9.14.1 ships the surface; subsequent iterations (9.14.2+) wire it
 * into the entities service as the service comes online.
 */

export * from "./task";
export * from "./project";
export * from "./surface";
