/**
 * Re-export shim — the vault-entity title index now lives in
 * `@brainstorm/editor` (`plugins/entity-index`), decoupled from the app
 * runtime via an injected source (`setEntityIndexSource`, wired in Notes'
 * boot). Notes-local imports keep working through here; new code should
 * import from `@brainstorm/editor` directly.
 */

export {
	entitiesSnapshotList,
	entityTitleOf,
	entityTitlesSnapshot,
	getEntityTitle,
	subscribeEntityTitles,
} from "@brainstorm/editor";
