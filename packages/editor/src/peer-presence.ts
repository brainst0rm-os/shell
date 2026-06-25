/**
 * Peer presence — extracted to `@brainstorm/sdk/peer-presence` at copy two
 * (the Whiteboard presence overlay, 9.17.19, is the second consumer). This
 * module stays as a delegating re-export so the editor's public surface
 * (`@brainstorm/editor` → `peerColor` / `localPresence` / …) is unchanged.
 */

export {
	PEER_COLORS,
	PEER_NAME_MAX_LEN,
	localPresence,
	localPresenceName,
	peerColor,
	sanitizePeerName,
} from "@brainstorm/sdk/peer-presence";
