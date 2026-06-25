/**
 * Collab-C5 — per-identity **inbox channel** for cross-user wrap delivery.
 *
 * The blind relay routes by an opaque channel key. A `WrapBootstrap` for a
 * freshly-shared entity can't reach the recipient on the *entity* channel —
 * they don't know the entity id to subscribe. So the recipient subscribes to a
 * deterministic channel derived from THEIR OWN sovereign pubkey, and the owner
 * (who has the recipient's pubkey from the `ShareInvite`) emits the wrap there
 * via the routing-header `route` override. Both sides derive the same string
 * from the same base64 pubkey, so no directory is needed.
 *
 * The recipient's pubkey is already visible to the relay as the `sender` of
 * their own frames, so this exposes no new identity metadata; the `inbox:`
 * prefix just namespaces it away from entity-id channels.
 */

const INBOX_PREFIX = "inbox:";

/** The inbox channel for the identity whose base64 sovereign Ed25519 public key
 *  is `userPubB64` (an `access`-record member id / a `ShareInvite.userPubB64`
 *  / `bytesToBase64(devicePub)`). Deterministic + collision-free with entity
 *  ids (which never start with `inbox:`). */
export function inboxChannelFor(userPubB64: string): string {
	return `${INBOX_PREFIX}${userPubB64}`;
}

/** True when `channel` is an inbox routing key (vs an entity channel). */
export function isInboxChannel(channel: string): boolean {
	return channel.startsWith(INBOX_PREFIX);
}
