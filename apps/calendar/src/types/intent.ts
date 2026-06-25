/**
 * Calendar intent verbs (9.15e). Per-app enum, mirroring Tasks
 * (`apps/tasks/src/types/intent.ts`) — no raw verb-string literals
 * (no-string-discriminator convention). Values match the wire verbs
 * the manifest registers (`open` / `compose` / `quick-look`).
 */
export enum IntentVerb {
	Open = "open",
	Compose = "compose",
	QuickLook = "quick-look",
}
