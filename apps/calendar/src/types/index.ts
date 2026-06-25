/**
 * Type-level surface for the Calendar app's two canonical entity types
 * (`brainstorm/Event/v1`, `brainstorm/CalendarView/v1`) plus the view-kind
 * enum + week-start enum.
 *
 * Stage 9.15.1 ships the surface; subsequent iterations (9.15.1.5
 * preview drop, 9.15.2 real entities, 9.15.3 inline-event BP block,
 * 9.15.4 birthdays cross-app) wire it into the entities service as the
 * service comes online.
 */

export * from "./event";
export * from "./calendar-view";
