/**
 * Re-export shim — `MentionNode` now lives in `@brainstorm/editor`.
 * Notes-local imports keep working through here; new code should import
 * from `@brainstorm/editor` directly.
 */

export {
	MENTION_NODE_TYPE,
	type SerializedMentionNode,
	$createMentionNode,
	$isMentionNode,
	MentionNode,
} from "@brainstorm/editor";
