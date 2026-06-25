/**
 * The shell-provided fallback block id and its always-registered
 * helper.
 *
 * Every vault embed paints through this id by default — the
 * `BlockEmbedNode` constructor seeds it when no provider is named, and
 * the {@link createBlockRendererRegistry} caller pre-registers it as a
 * custom-node so the resolver never falls into the "no provider"
 * branch for it. Living here (not in the registry module) keeps the
 * pure resolver implementation framework-agnostic — the shell-card
 * identity is a separate keystone.
 */

/** The render id used by the shell's generic entity preview. Mirrors
 *  `SHELL_ENTITY_CARD_BLOCK_ID` in `apps/notes/src/editor/nodes/block-embed-node.tsx`.
 *  These must stay byte-identical — a future iteration may centralise
 *  the constant; today both spell it out, with this comment as the
 *  guardrail. */
export const SHELL_ENTITY_CARD_BLOCK_ID = "io.brainstorm.shell/entity-card/v1";

/** The default custom-node seed every registry creation should include —
 *  call sites pass this through to `createBlockRendererRegistry({ builtInCustomNodes })`
 *  so the shell fallback resolves as `CustomNode`, not `Fallback`. */
export const DEFAULT_BUILTIN_CUSTOM_NODES: readonly string[] = Object.freeze([
	SHELL_ENTITY_CARD_BLOCK_ID,
]);
