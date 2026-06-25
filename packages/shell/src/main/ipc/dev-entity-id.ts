/**
 * Dev-IPC `entityId` validator — used by the soak (`soak-handlers.ts`) and
 * collab (`collab-dev-handlers.ts`) dev surfaces. Delegates to the shared
 * production asserter in `main/storage/entity-id.ts` so the path-traversal
 * charset (`[A-Za-z0-9_-]{1,128}`) lives in exactly one place — see that
 * module for why this is a security boundary (the 10.9b pentest finding).
 */

import { SAFE_ENTITY_ID_RE, assertSafeEntityId } from "../storage/entity-id";

export const DEV_ENTITY_ID_RE = SAFE_ENTITY_ID_RE;

export function assertDevEntityId(value: unknown): asserts value is string {
	assertSafeEntityId(value);
}
