/**
 * Type-level surface for the Whiteboard app's two canonical entity types
 * (`brainstorm/Whiteboard/v1`, `brainstorm/WhiteboardEdge/v1`) plus the
 * node-kind + handle-side + edge-path + arrowhead enums.
 *
 * Stage 9.17.1 ships the surface; subsequent iterations land per
 * `docs/implementation-plan.md §Stage 9.17`:
 *   - 9.17.1.5 preview drop (in-memory whiteboard + SVG renderer + the
 *     handle-based edge engine)
 *   - 9.17.2 real entities + per-board YDoc
 *   - 9.17.3 node primitives (Sticky / Text / Image / Frame / Group)
 *   - 9.17.4 Embedded node kind via Block Protocol
 *   - 9.17.5 Pixi renderer swap (mirrors Graph 9.13.5)
 *   - 9.17.6 connector UX polish (arrowheads + step-path obstacle
 *     routing)
 *   - 9.17.7 `embedded-whiteboard` BP block
 *   - 9.17.8 export (SVG / PNG / JSON)
 */

export * from "./whiteboard";
export * from "./node";
export * from "./edge";
