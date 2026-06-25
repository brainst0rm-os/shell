/**
 * `@brainstorm/sdk/block-runtime` — the in-iframe harness a first-party BP
 * block bundle boots with. Pairs with the host-side `@brainstorm/sdk/block-
 * mount` + `@brainstorm/sdk/block-frame`; see {@link ./block-runtime.ts}.
 */

export {
	BlockControlKind,
	type BlockBoot,
	type BlockRuntimeContext,
	startBlock,
} from "./block-runtime";
export { collectBlockThemeVars } from "./collect-theme";
