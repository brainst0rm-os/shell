/**
 * Re-export shim — mention trigger/filter ops now live in
 * `@brainstorm/editor`. Notes-local imports (transclusion / block-embed /
 * link-markup typeaheads) keep working through here; new code should
 * import from `@brainstorm/editor` directly.
 */

export {
	type MentionTrigger,
	type EntityFilterResult,
	detectMentionTrigger,
	entityDisplayName,
	filterEntities,
} from "@brainstorm/editor";
