/**
 * Help-1 — local route state for the Help overlay. Keeps the active
 * topicId in component state plus mirrors it into `location.hash` so a
 * reload + reopen lands on the same article. The hash is namespaced
 * under `#help/` so it doesn't collide with future hash-driven routes.
 *
 * Deliberately tiny — Help-2 hooks the `?` chord through this hook so
 * the dashboard surface can deep-link without inventing a second URL
 * shape.
 */

import { useCallback, useState } from "react";

const HASH_PREFIX = "#help/";

export function readHashTopicId(): string | null {
	if (typeof window === "undefined") return null;
	const hash = window.location.hash;
	if (!hash.startsWith(HASH_PREFIX)) return null;
	const rest = hash.slice(HASH_PREFIX.length);
	return rest.length > 0 ? rest : null;
}

export function writeHashTopicId(topicId: string | null): void {
	if (typeof window === "undefined") return;
	const next = topicId ? `${HASH_PREFIX}${topicId}` : "";
	if (window.location.hash === next) return;
	try {
		window.history.replaceState(null, "", next.length > 0 ? next : window.location.pathname);
	} catch {
		window.location.hash = next;
	}
}

export function useHelpRoute(initialTopicId: string | null): {
	readonly topicId: string | null;
	readonly setTopicId: (next: string | null) => void;
} {
	const [topicId, setTopicIdState] = useState<string | null>(
		() => initialTopicId ?? readHashTopicId(),
	);
	const setTopicId = useCallback((next: string | null) => {
		setTopicIdState(next);
		writeHashTopicId(next);
	}, []);
	return { topicId, setTopicId };
}
