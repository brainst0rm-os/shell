/**
 * `aria-live` politeness levels for the shell-mounted live region — used by
 * `announce(message, { politeness })` from KBN-1b. Mirrors the spec's
 * `polite` / `assertive` values exactly so the enum value IS the wire string.
 */
export enum KbnAnnouncePoliteness {
	Polite = "polite",
	Assertive = "assertive",
}
