/**
 * Type-level surface for the Preview app — the renderer-module contract
 * + the `PreviewKind` enum + the kind/MIME resolver. These are the
 * long-term keystones from [[preview-drop-pattern]] that survive every
 * renderer-iteration swap (9.20.2 image / 9.20.3 av / 9.20.4 code /
 * 9.20.5 PDF).
 *
 * Stage 9.20.1 ships the surface + an empty registry; 9.20.1.5 wires
 * the image + markdown + text renderers behind the same contract.
 */

export * from "./preview-context";
export * from "./preview-kind";
export * from "./preview-module";
