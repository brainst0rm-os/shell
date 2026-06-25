/**
 * Re-export shim — `DateMentionNode` now lives in `@brainstorm/editor`.
 * Notes-local imports keep working through here; new code should import
 * from `@brainstorm/editor` directly.
 */

export {
	DATE_MENTION_NODE_TYPE,
	type SerializedDateMentionNode,
	$createDateMentionNode,
	$isDateMentionNode,
	DateMentionNode,
} from "@brainstorm/editor";
