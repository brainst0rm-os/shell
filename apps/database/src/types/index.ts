/**
 * Type-level surface for the Database app's two canonical entity types
 * (`brainstorm/List/v1`, `brainstorm/ListView/v1`) plus the predicate
 * and view-config shapes documented in
 *
 * These types intentionally have no runtime imports from the SDK or shell.
 * Stage 9.12.1 ships the surface; subsequent iterations (9.12.2+) wire it
 * into the entities service as the service comes online.
 */

export * from "./icon";
export * from "./predicate";
export * from "./list-source";
export * from "./list-view";
export * from "./list";
