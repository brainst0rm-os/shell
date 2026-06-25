/**
 * The intent verbs Database handles on the running-app push channel
 * (9.12.14). Values are the wire strings the shell delivers per the
 * manifest's `registrations.intents`; centralised so the dispatcher
 * stays off raw string discriminators (CLAUDE.md). Mirrors
 * `apps/tasks/src/types/intent.ts`.
 */

export enum IntentVerb {
	Open = "open",
}
