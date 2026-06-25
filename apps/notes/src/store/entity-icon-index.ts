/**
 * Re-export shim — the vault-entity icon index now lives in
 * `@brainstorm/editor` (`plugins/entity-index`), merged with the title
 * index and fed by the same injected source (`setEntityIndexSource`,
 * wired in Notes' boot). Notes-local imports keep working through here;
 * new code should import from `@brainstorm/editor` directly.
 */

export {
	entityIconsSnapshot,
	getEntityIcon,
	subscribeEntityIcons,
} from "@brainstorm/editor";
